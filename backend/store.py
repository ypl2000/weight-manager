"""SQLite 存储层:通用文档表(docs) + 追加式历史(history) + 元数据(meta) + 每日快照。

所有业务数据都以文档形式存在 docs 表里,便于统一做 LWW 同步与历史回滚:
  docs(table_name, id, data JSON, updated_at ISO, deleted, seq 服务端递增号)
"""
import json
import sqlite3
import threading
import datetime as dt
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "data"
BACKUP_DIR = DATA_DIR / "backups"
DB_PATH = DATA_DIR / "app.db"
_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS docs(
  table_name TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  seq        INTEGER NOT NULL,
  PRIMARY KEY(table_name, id)
);
CREATE INDEX IF NOT EXISTS idx_docs_seq ON docs(seq);
CREATE TABLE IF NOT EXISTS history(
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  doc_id     TEXT NOT NULL,
  data       TEXT,
  updated_at TEXT NOT NULL,
  deleted    INTEGER NOT NULL,
  device     TEXT,
  action     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
"""


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DATA_DIR.mkdir(exist_ok=True)
    BACKUP_DIR.mkdir(exist_ok=True)
    with _lock, _conn() as c:
        c.executescript(SCHEMA)


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def today():
    return dt.date.today().isoformat()


def next_seq(c):
    return c.execute("SELECT COALESCE(MAX(seq),0)+1 AS n FROM docs").fetchone()["n"]


def upsert_doc(table, doc_id, data, updated_at, deleted, device, force=False):
    """按 updated_at 后写者胜写入;force=True 跳过比较(恢复/回滚)。返回是否生效。"""
    payload = json.dumps(data, ensure_ascii=False)
    deleted_i = 1 if deleted else 0
    with _lock, _conn() as c:
        row = c.execute(
            "SELECT updated_at FROM docs WHERE table_name=? AND id=?", (table, doc_id)
        ).fetchone()
        if not force and row and row["updated_at"] >= updated_at:
            return False
        c.execute(
            """INSERT INTO docs(table_name,id,data,updated_at,deleted,seq)
               VALUES(?,?,?,?,?,?)
               ON CONFLICT(table_name,id) DO UPDATE SET
                 data=excluded.data, updated_at=excluded.updated_at,
                 deleted=excluded.deleted, seq=excluded.seq""",
            (table, doc_id, payload, updated_at, deleted_i, next_seq(c)),
        )
        c.execute(
            """INSERT INTO history(table_name,doc_id,data,updated_at,deleted,device,action,created_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (table, doc_id, payload, updated_at, deleted_i, device,
             "delete" if deleted else "update", now_iso()),
        )
        return True


def _row_to_doc(r):
    return {"table": r["table_name"], "id": r["id"], "data": json.loads(r["data"]),
            "updated_at": r["updated_at"], "deleted": bool(r["deleted"])}


def get_all(table, include_deleted=False):
    with _conn() as c:
        if include_deleted:
            rows = c.execute("SELECT * FROM docs WHERE table_name=?", (table,)).fetchall()
        else:
            rows = c.execute("SELECT * FROM docs WHERE table_name=? AND deleted=0", (table,)).fetchall()
        return [_row_to_doc(r) for r in rows]


def get_doc(table, doc_id):
    with _conn() as c:
        r = c.execute("SELECT * FROM docs WHERE table_name=? AND id=?", (table, doc_id)).fetchone()
        return _row_to_doc(r) if r else None


def changes_since(cursor, limit=2000):
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM docs WHERE seq>? ORDER BY seq LIMIT ?", (cursor, limit)
        ).fetchall()
        docs = [_row_to_doc(r) for r in rows]
        max_seq = rows[-1]["seq"] if rows else cursor
        return docs, max_seq


def list_history(table=None, doc_id=None, limit=100):
    q = "SELECT * FROM history"
    cond, args = [], []
    if table:
        cond.append("table_name=?"); args.append(table)
    if doc_id:
        cond.append("doc_id=?"); args.append(doc_id)
    if cond:
        q += " WHERE " + " AND ".join(cond)
    q += " ORDER BY seq DESC LIMIT ?"
    args.append(limit)
    with _conn() as c:
        rows = c.execute(q, args).fetchall()
        return [{"seq": r["seq"], "table": r["table_name"], "doc_id": r["doc_id"],
                 "data": json.loads(r["data"]) if r["data"] else None,
                 "updated_at": r["updated_at"], "deleted": bool(r["deleted"]),
                 "device": r["device"], "action": r["action"], "created_at": r["created_at"]}
                for r in rows]


def get_history_row(seq):
    with _conn() as c:
        r = c.execute("SELECT * FROM history WHERE seq=?", (seq,)).fetchone()
        if not r:
            return None
        return {"table": r["table_name"], "doc_id": r["doc_id"],
                "data": json.loads(r["data"]) if r["data"] else None,
                "updated_at": r["updated_at"], "deleted": bool(r["deleted"])}


def get_meta(key):
    with _conn() as c:
        r = c.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return json.loads(r["value"]) if r else None


def set_meta(key, value):
    with _lock, _conn() as c:
        c.execute("INSERT INTO meta(key,value) VALUES(?,?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  (key, json.dumps(value, ensure_ascii=False)))


def all_docs():
    with _conn() as c:
        rows = c.execute("SELECT * FROM docs").fetchall()
        return [_row_to_doc(r) for r in rows]


def snapshot_if_needed(keep=30):
    """每天首次启动时做一次全量快照 JSON,便于整体回滚。"""
    today_s = today()
    if (get_meta("last_snapshot") or "") == today_s:
        return None
    docs = all_docs()
    path = BACKUP_DIR / f"snapshot-{today_s}.json"
    path.write_text(json.dumps({"version": 1, "created_at": now_iso(), "docs": docs},
                               ensure_ascii=False, indent=1), encoding="utf-8")
    set_meta("last_snapshot", today_s)
    snaps = sorted(BACKUP_DIR.glob("snapshot-*.json"))
    for old in snaps[:-keep]:
        old.unlink(missing_ok=True)
    return str(path)


def restore_docs(docs):
    """用快照内容覆盖本地(强制写入,留下 history)。"""
    n = 0
    for d in docs:
        upsert_doc(d["table"], d["id"], d.get("data") or {}, now_iso(),
                   bool(d.get("deleted")), "restore", force=True)
        n += 1
    return n
