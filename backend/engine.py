"""阶段判定引擎:按 stages 里的规则组评估最近数据,给出建议与逐条依据。

规则字段:
  metric      指标 code,特殊值 "workouts" 表示运动打卡频率
  op          gte / lte / gt / lt(数值比较)或 freq_gte(打卡频率,次/周)
  agg         latest(窗口内最新值) / avg / trend_down(线性斜率<0)
  value       数字,或 {"all":85,"male":90} 性别差异化阈值
  window_days 评估窗口天数(默认14)
"""
import datetime as dt


def _parse(ts):
    try:
        return dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except Exception:
        return None


def _thresh(v, gender):
    if isinstance(v, dict):
        return v.get(gender, v.get("all"))
    return v


def _slope(ys):
    n = len(ys)
    if n < 2:
        return 0.0
    xs = list(range(n))
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = sum((x - mx) ** 2 for x in xs)
    return num / den if den else 0.0


_SYMBOL = {"gte": "≥", "lte": "≤", "gt": ">", "lt": "<"}


def evaluate_rule(rule, records_by_metric, workout_days, gender, metrics_map,
                  now, default_window=14):
    metric = rule.get("metric")
    op = rule.get("op", "lte")
    win = int(rule.get("window_days") or default_window)
    name = metrics_map.get(metric, {}).get("name", metric)
    unit = metrics_map.get(metric, {}).get("unit", "")

    if metric == "workouts":
        weeks = max(win / 7.0, 1e-9)
        freq = len(workout_days) / weeks
        target = float(rule.get("value") or 0)
        ok = freq >= target - 1e-9
        return {"text": f"运动打卡 ≥{target:g}次/周(最近{win}天)", "ok": ok,
                "detail": f"实际约 {freq:.1f} 次/周(共{len(workout_days)}天有打卡)"}

    vals = []
    cut = now - dt.timedelta(days=win)
    for r in records_by_metric.get(metric, []):
        at = _parse(r.get("at"))
        if at and at >= cut:
            try:
                vals.append((at, float(r.get("value"))))
            except (TypeError, ValueError):
                pass
    vals.sort(key=lambda x: x[0])
    ys = [v for _, v in vals]

    def fail(detail):
        return {"text": "", "ok": False, "detail": detail}

    agg = rule.get("agg", "latest")
    if agg == "trend_down":
        ok = len(ys) >= 3 and _slope(ys) < 0
        text = f"{name}呈下降趋势(最近{win}天)"
        detail = f"{len(ys)}个数据点" + (f",斜率{_slope(ys):+.3g}" if len(ys) >= 2 else "")
        return {"text": text, "ok": ok, "detail": detail}
    if not ys:
        t = _thresh(rule.get("value"), gender)
        unit_s = f" {unit}" if unit else ""
        text = (f"{name} {_SYMBOL.get(op, op)} {t:g}{unit_s}(最近{win}天)"
                if t is not None else f"{name}(最近{win}天)")
        return {"text": text, "ok": False, "detail": f"最近{win}天暂无「{name}」数据"}
    if agg == "avg":
        cur = sum(ys) / len(ys)
        agg_label = "平均值"
    else:
        cur = ys[-1]
        agg_label = "最新值"
    t = _thresh(rule.get("value"), gender)
    if t is None:
        return fail("规则未设置阈值")
    ok = cur >= t if op == "gte" else cur <= t if op == "lte" else cur > t if op == "gt" else cur < t
    unit_s = f" {unit}" if unit else ""
    return {"text": f"{name} {_SYMBOL.get(op, op)} {t:g}{unit_s}(最近{win}天{agg_label})",
            "ok": ok, "detail": f"当前 {cur:g}{unit_s}"}


def suggest(profile, stages, records, workouts, metrics, window_days=14):
    gender = profile.get("gender") or "all"
    now = dt.datetime.now(dt.timezone.utc)
    cut = now - dt.timedelta(days=window_days)

    records_by_metric = {}
    for r in records:
        at = _parse(r.get("at"))
        if at and at >= cut:
            records_by_metric.setdefault(r.get("metric_code"), []).append(
                dict(r, _at=at))

    workout_days = set()
    for w in workouts:
        d = w.get("date")
        if d:
            workout_days.add(d)

    metrics_map = {m.get("code"): m for m in metrics}
    active = [s for s in stages if s.get("active", True)]
    active.sort(key=lambda s: s.get("order") or 0, reverse=True)

    items = []
    for st in active:
        rules = [evaluate_rule(r, records_by_metric, workout_days, gender,
                               metrics_map, now, window_days)
                 for r in st.get("rules", [])]
        items.append({"stage_id": st.get("_id"), "name": st.get("name"),
                      "order": st.get("order") or 0, "color": st.get("color"),
                      "pass": all(r["ok"] for r in rules) if rules else True,
                      "rules": rules})

    best = items[0] if items else None
    for it in items:  # items 按 order 降序,第一个全过的即建议阶段
        if it["pass"]:
            best = it
            break
    items.sort(key=lambda x: x["order"])
    return {"suggested": best["stage_id"] if best else None, "window_days": window_days,
            "gender": gender, "items": items}
