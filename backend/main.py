"""体重管理服务端:FastAPI + SQLite。

同一进程提供:
  - /api/*    同步、CRUD、历史回滚、快照、阶段判定、图片识别
  - /*        前端 PWA 静态页面(frontend/dist)
"""
import csv
import io
import json
from pathlib import Path

from fastapi import FastAPI, Request, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, FileResponse, Response, StreamingResponse

import store
import seed
import engine
import recognize
import importers
import coach
import insights
import reminders

app = FastAPI(title="体重管理")
DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@app.on_event("startup")
def _startup():
    store.init_db()
    seed.seed_if_empty()
    store.snapshot_if_needed()


@app.middleware("http")
async def _pin_guard(request, call_next):
    p = request.url.path
    if p.startswith("/api") and p != "/api/unlock":
        pin = (store.get_meta("pin") or {}).get("code") or ""
        if pin and request.headers.get("x-access-code") != pin:
            return JSONResponse({"detail": "需要访问码"}, status_code=401)
    return await call_next(request)


# ---------- 访问码 ----------

@app.post("/api/unlock")
async def unlock(request: Request):
    body = await request.json()
    pin = (store.get_meta("pin") or {}).get("code") or ""
    if pin and body.get("code") != pin:
        raise HTTPException(403, "访问码不对")
    return {"ok": True}


@app.get("/api/meta/{key}")
def meta_get(key: str):
    if key == "pin":
        return {"set": bool((store.get_meta("pin") or {}).get("code"))}
    return store.get_meta(key)


@app.put("/api/meta/{key}")
async def meta_put(key: str, request: Request):
    body = await request.json()
    store.set_meta(key, body)
    return {"ok": True}


# ---------- 同步 ----------

@app.post("/api/sync")
async def sync(request: Request):
    body = await request.json()
    device = body.get("device") or "unknown"
    cursor = int(body.get("cursor") or 0)
    applied = 0
    for ch in body.get("changes") or []:
        store.upsert_doc(ch["table"], ch["id"], ch.get("data") or {},
                         ch.get("updated_at") or store.now_iso(),
                         bool(ch.get("deleted")), device)
        applied += 1
    docs, new_cursor = store.changes_since(cursor)
    return {"applied": applied, "changes": docs, "cursor": new_cursor}


# ---------- 通用 CRUD(电脑端直接操作) ----------

@app.get("/api/tables/{name}")
def table_all(name: str):
    return store.get_all(name)


@app.put("/api/tables/{name}/{doc_id}")
async def table_put(name: str, doc_id: str, request: Request):
    body = await request.json()
    store.upsert_doc(name, doc_id, body.get("data") or {},
                     body.get("updated_at") or store.now_iso(),
                     bool(body.get("deleted")), "server")
    return {"ok": True}


@app.delete("/api/tables/{name}/{doc_id}")
def table_delete(name: str, doc_id: str):
    store.upsert_doc(name, doc_id, {}, store.now_iso(), True, "server")
    return {"ok": True}


# ---------- 历史与回滚 ----------

@app.get("/api/history")
def history(table: str = None, doc_id: str = None, limit: int = 100):
    return store.list_history(table, doc_id, min(limit, 500))


@app.post("/api/history/{seq}/restore")
def history_restore(seq: int):
    row = store.get_history_row(seq)
    if not row:
        raise HTTPException(404, "历史不存在")
    if not row["data"]:  # None 或空 dict:软删除产生的空版本,恢复会出现可见空记录
        raise HTTPException(400, "该历史为删除操作产生的空版本,不可恢复")
    store.upsert_doc(row["table"], row["doc_id"], row["data"], store.now_iso(),
                     False, "restore", force=True)
    return {"ok": True}


# ---------- 快照备份 / 导出导入 ----------

@app.get("/api/snapshots")
def snapshots():
    files = sorted(store.BACKUP_DIR.glob("snapshot-*.json"), reverse=True)
    return [{"name": f.name, "size": f.stat().st_size} for f in files]


@app.get("/api/snapshots/{name}")
def snapshot_download(name: str):
    if "/" in name or "\\" in name or not name.startswith("snapshot-"):
        raise HTTPException(400, "名字不对")
    f = store.BACKUP_DIR / name
    if not f.is_file():
        raise HTTPException(404, "快照不存在")
    return FileResponse(f, filename=name, media_type="application/json")


@app.post("/api/restore")
async def restore(request: Request):
    body = await request.json()
    docs = body.get("docs")
    if docs is None and body.get("name"):
        f = store.BACKUP_DIR / body["name"]
        if "/" in body["name"] or not f.is_file():
            raise HTTPException(404, "快照不存在")
        docs = json.loads(f.read_text(encoding="utf-8"))["docs"]
    if docs is None:
        raise HTTPException(400, "缺少 docs 或 name")
    n = store.restore_docs(docs)
    return {"ok": True, "restored": n}


@app.get("/api/export/all")
def export_all():
    payload = json.dumps({"version": 1, "docs": store.all_docs()},
                         ensure_ascii=False, indent=1)
    return Response(payload, media_type="application/json",
                    headers={"Content-Disposition": "attachment; filename=weight-all.json"})


@app.get("/api/export/records.csv")
def export_csv():
    metrics = {m["id"]: m["data"] for m in store.get_all("metrics")}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["指标", "数值", "单位", "时间", "来源", "备注"])
    for r in store.get_all("records"):
        d = r["data"]
        m = next((v for v in metrics.values() if v.get("code") == d.get("metric_code")), {})
        w.writerow([m.get("name", d.get("metric_code")), d.get("value"), d.get("unit") or m.get("unit", ""),
                    d.get("at"), d.get("source", ""), d.get("note", "")])
    return Response("\ufeff" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=records.csv"})


# ---------- 阶段判定 ----------

@app.get("/api/stage-suggestion")
def stage_suggestion(window: int = 14):
    profile = store.get_doc("profile", "me")
    stages = [{**d["data"], "_id": d["id"]} for d in store.get_all("stages")]
    return engine.suggest(
        (profile or {}).get("data", {}),
        stages,
        [d["data"] for d in store.get_all("records")],
        [d["data"] for d in store.get_all("workouts")],
        [d["data"] for d in store.get_all("metrics")],
        window,
    )


# ---------- 智能洞察(迭代3,纯规则不调模型) ----------

@app.get("/api/insights")
def insights_api():
    return insights.build()


# ---------- 测量提醒(迭代4,纯读取不写数据) ----------

@app.get("/api/reminders")
def reminders_api():
    return reminders.build()


# ---------- 图片识别 ----------

@app.post("/api/recognize")
async def recognize_api(image: UploadFile = File(...)):
    cfg = store.get_meta("ai") or {}
    raw = await image.read()
    if not raw:
        raise HTTPException(400, "图片为空")
    mime = image.content_type or "image/jpeg"
    metrics = [d["data"] for d in store.get_all("metrics")]
    try:
        return await recognize.recognize_image(raw, mime, cfg, metrics)
    except Exception as e:
        raise HTTPException(400, str(e))


# ---------- 数据导入(迭代1) ----------

@app.post("/api/import/preview")
async def import_preview(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "文件为空")
    if len(raw) > 200 * 1024 * 1024:
        raise HTTPException(400, "文件过大(上限200MB)")
    try:
        return importers.preview(raw, file.filename or "")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # 未知解析异常也不该 500
        raise HTTPException(400, f"解析失败:{e}")


@app.post("/api/import/commit")
async def import_commit(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "请求体必须是 JSON")
    rows = body.get("rows")
    if not isinstance(rows, list):
        raise HTTPException(400, "rows 必须是数组")
    if len(rows) > importers.MAX_ROWS:
        raise HTTPException(400, f"行数超过上限{importers.MAX_ROWS}")
    note = str(body.get("note") or "批量导入")
    units = {}
    for m in store.get_all("metrics"):
        units[m["data"].get("code")] = m["data"].get("unit", "")
    imported = skipped = 0
    for row in rows:
        if not isinstance(row, dict):
            skipped += 1
            continue
        try:
            moment = importers.parse_datetime(row.get("at"))
        except ValueError:
            skipped += 1
            continue
        epoch = int(moment.timestamp())
        metrics = row.get("metrics") or {}
        if not isinstance(metrics, dict) or not metrics:
            skipped += 1
            continue
        for code, value in metrics.items():
            try:
                val = round(float(value), 2)
            except (TypeError, ValueError):
                skipped += 1
                continue
            lo, hi = importers.RANGES.get(code, (float("-inf"), float("inf")))
            if not lo <= val <= hi:
                skipped += 1
                continue
            doc_id = f"imp_{code}_{epoch}"  # 确定性 id:同一秒同一指标只留一条
            existing = store.get_doc("records", doc_id)
            if existing and not existing.get("deleted"):
                # D6:仅"已存在且未删除"才跳过。存活记录一律首写优先不覆盖(值相同=幂等重导,
                # 值不同=冲突也不覆盖):同一秒两个来源数值不同时若按新值覆盖会来回改写,
                # 重复 commit 的 imported 永远不归 0,且每轮都产生 history/同步增量。
                skipped += 1
                continue
            # 其余两种情况写入:不存在 → 首次导入;existing.deleted=true → 墓碑占位,
            # 正常写入复活(D6:deleted=0,updated_at=now;upsert 按 updated_at LWW,
            # now 必新于墓碑,必生效),误删数据可通过重导同一文件恢复。
            store.upsert_doc("records", doc_id,
                             {"metric_code": code, "value": val,
                              "unit": units.get(code, ""), "at": row.get("at"),
                              "note": note, "source": "import"},
                             store.now_iso(), False, "import")
            imported += 1
    return {"imported": imported, "skipped": skipped}


# ---------- AI 教练(迭代2) ----------

@app.post("/api/coach/report")
async def coach_report(request: Request):
    def _sse(payload):
        return "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"

    # 校验在返回 StreamingResponse 之前完成(响应开始后不能再读 body,
    # BaseHTTPMiddleware 下会死锁);校验失败只发一条 error 事件,不调模型。
    try:
        body = await request.json()
    except Exception:  # 空 body / 坏 JSON
        body = None
    error = None
    days = 30  # 缺省 30
    if isinstance(body, dict):
        raw = body.get("days", 30)
        # bool 是 int 的子类,须排除;仅接受 1-365 的整数
        if isinstance(raw, bool) or not isinstance(raw, int) or not 1 <= raw <= 365:
            error = "days 必须是1-365的整数"
        else:
            days = raw
    else:
        error = "请求体必须是JSON对象"

    async def gen():
        if error:
            yield _sse({"error": error})
            return
        async for ev in coach.stream_report(days):
            if "delta" in ev:
                payload = {"delta": ev["delta"]}
            elif "error" in ev:
                payload = {"error": ev["error"]}
            elif ev.get("done"):
                payload = {"done": True, "report_id": ev["report_id"]}
            else:
                continue
            yield _sse(payload)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@app.post("/api/coach/ask")
async def coach_ask(request: Request):
    def _sse(payload):
        return "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"

    # 校验前置(D3 教训):响应开始后不能再读 body;校验失败只发一条 error 事件,零模型调用。
    try:
        body = await request.json()
    except Exception:  # 空 body / 坏 JSON
        body = None
    error = question = None
    if not isinstance(body, dict):
        error = "请求体必须是JSON对象"
    else:
        raw = body.get("question")
        if not isinstance(raw, str):
            error = "question 必须是字符串"
        else:
            q = raw.strip()
            if not q:
                error = "question 不能为空"
            elif len(q) > 500:
                error = "question 长度不能超过500字"
            else:
                question = q

    async def gen():
        if error:
            yield _sse({"error": error})
            return
        async for ev in coach.stream_ask(question):
            if "delta" in ev:
                payload = {"delta": ev["delta"]}
            elif "error" in ev:
                payload = {"error": ev["error"]}
            elif ev.get("done"):
                payload = {"done": True, "qa_id": ev["qa_id"]}
            else:
                continue
            yield _sse(payload)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


# ---------- 前端静态页面 ----------

@app.get("/{full_path:path}")
def spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404)
    f = DIST / full_path
    if full_path and f.is_file():
        return FileResponse(f)
    index = DIST / "index.html"
    if not index.is_file():
        return Response("前端尚未构建:请在 frontend 目录执行 npm install && npm run build",
                        media_type="text/plain; charset=utf-8")
    return FileResponse(index)
