"""测量提醒(迭代4):weight/waist 两个指标的到期提醒,纯读取、不写任何数据。

规则:
  - 只覆盖 metrics 表中启用(active=True)的 weight / waist;名称取自 metrics,不硬编码。
  - weight  每天 1 次:今天(服务器本地时区,UTC+8)还没有记录 → due;
            已记录 → 不 due("今天已记录")。
  - waist   每周 1 次:最近一条记录距今 ≥7 天或从未记录 → due;
            否则 → "N 天前测过（MM-DD）"。
  - 指标停用(active=False)→ 不出现在 items 里。

取数复用 store.get_all 的文档风格;时间解析与 insights 一致按 ISO 容错处理。
"""
import datetime as dt

import store

# 提醒只覆盖这两个指标,按此顺序输出
REMINDER_CODES = ("weight", "waist")
# 各指标的频率规则文案
RULES = {"weight": "每天 1 次", "waist": "每周 1 次"}
WAIST_INTERVAL_DAYS = 7


def _parse(ts):
    """ISO 时间容错解析(与 engine._parse 同风格);失败返回 None。"""
    try:
        return dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except Exception:
        return None


def build():
    now_local = dt.datetime.now().astimezone()  # 服务器本地时区(UTC+8)
    today = now_local.date()
    metrics = {}
    for d in store.get_all("metrics"):
        data = d["data"]
        code = data.get("code")
        if code:
            metrics[code] = data
    records = [d["data"] for d in store.get_all("records")]

    items = []
    for code in REMINDER_CODES:
        m = metrics.get(code)
        if not m or not m.get("active"):
            continue  # 指标不存在或已停用 → 不出现在 items
        has_today = False
        latest = None  # 最近一条记录的本地时间
        for r in records:
            if r.get("metric_code") != code:
                continue
            at = _parse(r.get("at"))
            if not at:
                continue
            if at.tzinfo is None:  # 无时区的按服务器本地时间理解
                at = at.replace(tzinfo=now_local.tzinfo)
            local_at = at.astimezone(now_local.tzinfo)
            if local_at.date() == today:
                has_today = True
            if latest is None or local_at > latest:
                latest = local_at

        if code == "weight":
            if has_today:
                due, reason = False, "今天已记录"
            else:
                due, reason = True, "今天还没有记录"
        else:  # waist
            if latest is None:
                due, reason = True, "还没有记录过"
            else:
                days = (today - latest.date()).days
                if days >= WAIST_INTERVAL_DAYS:
                    due, reason = True, f"距上次测量已 {days} 天"
                else:
                    due, reason = False, f"{days} 天前测过（{latest.strftime('%m-%d')}）"

        items.append({"code": code, "name": m.get("name", code),
                      "due": due, "reason": reason, "rule": RULES[code]})

    return {"generated_at": store.now_iso(), "items": items}
