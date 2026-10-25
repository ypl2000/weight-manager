"""AI 教练(迭代2):聚合最近 N 天健康数据,调用大模型流式生成分析报告。

- build_summary(days): 从 store 聚合 指标首值/最新值/均值/极值/斜率、体重周均、
  习惯打卡坚持率、有氧/力量训练次数、当前阶段与阶段判定结论、BMI;
  数据不足的维度如实标注,不编造。
- stream_report(days): async generator,逐段 yield {"delta": 文本} 事件;
  流结束后把完整报告写入 docs 表 "coach_reports"(id=uuid, device="coach")。
  无 API Key 或调用失败时 yield {"error": 原因} 事件。
- 系统提示词内嵌了用户已学习的减脂知识原则(提炼自 docs/知识汇总-整理版.md)。
"""
import datetime as dt
import json
import uuid

import httpx

import engine
import store

DEFAULT_COACH_MODEL = "glm-5.3-flash"
DEFAULT_BASE = "https://open.bigmodel.cn/api/paas/v4"

# 教练必须遵守的知识原则(提炼自 docs/知识汇总-整理版.md)
SYSTEM_PROMPT = """你是一位严谨的私人减脂教练,基于用户的真实健康数据输出分析报告。用户已系统学习以下知识原则,你的每一条结论都必须与之一致:
1. 热量缺口是减脂效果最核心的底座,任何建议最终都要回到"如何维持合理的热量缺口";
2. 减重速率超过1kg/周时必须警示:快速减重会不成比例地流失肌肉与骨密度,减肥是马拉松,不是越快越好;
3. 蛋白质参考量:普通人群每天1.2-1.6g/kg体重,有力量训练习惯者1.6-2.2g/kg;
4. 体重短期波动多为水分(吃咸/碳水/生理期/运动炎症储水),要看长期趋势和周均值,不评判单日涨跌;
5. 平台期先分型:假平台=水分潴留,看腰围是否仍在下降;真平台=热量缺口消失(体重下降后代谢随之下降属正常生理现象;更常见是依从性不知不觉下滑,热量估算普遍被低估25%-50%,建议往高了估并复盘饮食记录"查账");
6. 只做生活方式与数据分析指导,不提供医疗诊断、用药建议;指标明显异常时建议就医。
输出格式:中文 markdown,固定四节:## 趋势解读、## 亮点、## 风险、## 下周建议。总长不超过600字,结论要给数字、说人话、不说空话;数据不足的维度如实说明"数据不足",禁止编造数值。"""


def _parse(ts):
    return engine._parse(ts)


def _slope_per_day(pts):
    """对 (时刻, 值) 序列做最小二乘,返回每天变化量;点数<2 返回 None。"""
    n = len(pts)
    if n < 2:
        return None
    t0 = pts[0][0]
    xs = [(at - t0).total_seconds() / 86400 for at, _ in pts]
    ys = [v for _, v in pts]
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = sum((x - mx) ** 2 for x in xs)
    return num / den if den else 0.0


def _r(v, nd=2):
    return round(v, nd) if isinstance(v, (int, float)) else v


def build_summary(days):
    """聚合最近 days 天数据为可直接阅读的dict;数据不足的维度带 insufficient 标注。"""
    days = max(1, int(days))
    now = dt.datetime.now(dt.timezone.utc)
    cut = now - dt.timedelta(days=days)

    profile = (store.get_doc("profile", "me") or {}).get("data", {})
    metrics_docs = [d["data"] for d in store.get_all("metrics")]
    metrics_map = {m.get("code"): m for m in metrics_docs}
    stages = [{**d["data"], "_id": d["id"]} for d in store.get_all("stages")]
    records = [d["data"] for d in store.get_all("records")]
    workouts = [d["data"] for d in store.get_all("workouts")]
    habit_logs = [d["data"] for d in store.get_all("habit_logs")]
    habits = {d["id"]: d["data"] for d in store.get_all("habits")}

    # ---- 指标趋势(窗口内) ----
    by_metric = {}
    for r in records:
        at = _parse(r.get("at"))
        if not at or at < cut:
            continue
        try:
            v = float(r.get("value"))
        except (TypeError, ValueError):
            continue
        by_metric.setdefault(r.get("metric_code"), []).append((at, v))

    metrics_stats = []
    for code, pts in by_metric.items():
        pts.sort(key=lambda x: x[0])
        ys = [v for _, v in pts]
        m = metrics_map.get(code, {})
        slope = _slope_per_day(pts)
        span = (pts[-1][0] - pts[0][0]).total_seconds() / 86400
        stat = {
            "code": code, "name": m.get("name", code), "unit": m.get("unit", ""),
            "count": len(ys),
            "first": _r(ys[0]), "latest": _r(ys[-1]),
            "avg": _r(sum(ys) / len(ys)), "min": _r(min(ys)), "max": _r(max(ys)),
            "change": _r(ys[-1] - ys[0]),
            "slope_per_week": _r(slope * 7, 3) if slope is not None else None,
        }
        if len(ys) < 3 or span < 3:
            stat["insufficient"] = f"仅{len(ys)}个数据点/跨度{span:.1f}天,数据不足,趋势仅供参考"
        metrics_stats.append(stat)
    metrics_stats.sort(key=lambda s: (metrics_map.get(s["code"], {}).get("sort") or 99))

    # ---- 体重周均(自然周,ISO 周号) ----
    weight_pts = by_metric.get("weight", [])
    weekly, weekly_note = [], None
    if weight_pts:
        buckets = {}
        for at, v in weight_pts:
            iso = at.date().isocalendar()
            buckets.setdefault(f"{iso[0]}-W{iso[1]:02d}", []).append(v)
        weekly = [{"week": k, "avg": _r(sum(vs) / len(vs)), "n": len(vs)}
                  for k, vs in sorted(buckets.items())]
        if len(weekly) < 2:
            weekly_note = "体重周均不足两周,数据不足,看不出周际趋势"
    else:
        weekly_note = "窗口内没有体重记录,数据不足"

    # ---- 习惯打卡坚持率 ----
    done_by_habit = {}
    for log in habit_logs:
        d = log.get("date")
        if not d or not log.get("done"):
            continue
        try:
            if dt.date.fromisoformat(str(d)[:10]) < cut.date():
                continue
        except ValueError:
            continue
        done_by_habit.setdefault(log.get("habit_id"), set()).add(str(d)[:10])
    habit_stats = []
    for hid, h in habits.items():
        if not h.get("active", True):
            continue
        n = len(done_by_habit.get(hid, ()))
        habit_stats.append({"name": h.get("name", hid), "done_days": n,
                            "window_days": days,
                            "rate": round(n / days * 100)})
    habit_stats.sort(key=lambda x: -x["rate"])
    if not any(h["done_days"] for h in habit_stats):
        habit_stats_note = "窗口内没有打卡记录,数据不足"
    else:
        habit_stats_note = None

    # ---- 训练次数 ----
    cardio_days, strength_days, other_days = set(), set(), set()
    for w in workouts:
        d = w.get("date")
        if not d:
            continue
        try:
            if dt.date.fromisoformat(str(d)[:10]) < cut.date():
                continue
        except ValueError:
            continue
        t = w.get("type")
        (cardio_days if t == "cardio" else strength_days if t == "strength" else other_days).add(str(d)[:10])
    workout_stats = {
        "cardio_count": len(cardio_days), "strength_count": len(strength_days),
        "other_count": len(other_days),
        "per_week": _r((len(cardio_days) + len(strength_days) + len(other_days)) / max(days / 7, 1), 1),
    }
    if workout_stats["cardio_count"] + workout_stats["strength_count"] + workout_stats["other_count"] == 0:
        workout_stats["insufficient"] = "窗口内没有训练打卡,数据不足"

    # ---- 阶段:用户设定 + 引擎判定(与 /api/stage-suggestion 同口径,window=14) ----
    current = next((s for s in stages if s["_id"] == profile.get("current_stage_id")), None)
    try:
        sug = engine.suggest(profile, stages, records, workouts, metrics_docs, 14)
        sug_stage = next((s for s in stages if s["_id"] == sug.get("suggested")), None)
        cur_item = next((it for it in sug.get("items", []) if it["stage_id"] == profile.get("current_stage_id")), None)
        fails = [r.get("detail") or r.get("text") for it in sug.get("items", [])
                 for r in it.get("rules", []) if not r["ok"]]
        stage_info = {
            "current": current.get("name") if current else None,
            "engine_suggested": sug_stage.get("name") if sug_stage else None,
            "current_stage_rules_pass": cur_item["pass"] if cur_item else None,
            "unmet_rules": fails,
        }
    except Exception as e:  # 判定引擎异常不应阻塞报告
        stage_info = {"current": current.get("name") if current else None,
                      "engine_suggested": f"阶段判定失败:{e}"}

    # ---- BMI ----
    bmi = bmi_note = None
    h = profile.get("height_cm")
    if weight_pts and h:
        try:
            hm = float(h) / 100
            if hm > 0:
                bmi = _r(weight_pts[-1][1] / (hm * hm))
        except (TypeError, ValueError):
            pass
    if bmi is None:
        bmi_note = "身高或体重缺失,BMI 数据不足"

    return {
        "days": days,
        "generated_at": store.now_iso(),
        "profile": {"gender": profile.get("gender") or "未填写",
                    "height_cm": profile.get("height_cm"),
                    "target_weight": profile.get("target_weight"),
                    "target_waist": profile.get("target_waist")},
        "bmi": bmi, "bmi_note": bmi_note,
        "metrics": metrics_stats,
        "weight_weekly": weekly, "weight_weekly_note": weekly_note,
        "habits": habit_stats, "habits_note": habit_stats_note,
        "workouts": workout_stats,
        "stage": stage_info,
    }


def _summary_text(s):
    """把聚合结果渲染成给模型看的紧凑中文文本。"""
    L = [f"统计窗口:最近{s['days']}天(截至 {s['generated_at'][:10]})"]
    p = s["profile"]
    L.append(f"档案:性别{p['gender']},身高{p['height_cm'] or '未填写'}cm,"
             f"目标体重{p['target_weight'] or '未填写'}kg,目标腰围{p['target_waist'] or '未填写'}cm")
    if s["bmi"] is not None:
        L.append(f"BMI(按最新体重):{s['bmi']}")
    else:
        L.append(f"BMI:{s['bmi_note']}")
    L.append("阶段:" + (f"用户当前在「{s['stage']['current']}」" if s['stage']['current'] else "未设定阶段")
             + (f";系统判定建议「{s['stage']['engine_suggested']}」" if s['stage'].get('engine_suggested') else ""))
    if s["stage"].get("unmet_rules"):
        L.append("未达标规则:" + ";".join(s["stage"]["unmet_rules"]))
    L.append("指标趋势(首值→最新 / 均值 / 最低~最高 / 斜率):")
    if s["metrics"]:
        for m in s["metrics"]:
            unit = f"{m['unit']}" if m["unit"] else ""
            line = (f"- {m['name']}: {m['first']}→{m['latest']}{unit},均值{m['avg']},"
                    f"{m['min']}~{m['max']},{m['count']}个点")
            if m["slope_per_week"] is not None:
                line += f",斜率{m['slope_per_week']}{unit}/周"
            if m.get("insufficient"):
                line += f"({m['insufficient']})"
            L.append(line)
    else:
        L.append("- (窗口内无任何测量记录,数据不足)")
    if s["weight_weekly"]:
        L.append("体重周均:" + " → ".join(f"{w['week']}周均{w['avg']}kg({w['n']}点)" for w in s["weight_weekly"]))
    elif s.get("weight_weekly_note"):
        L.append(f"体重周均:{s['weight_weekly_note']}")
    if s["habits"]:
        L.append("习惯打卡坚持率(窗口内):"
                 + ";".join(f"{h['name']} {h['done_days']}/{h['window_days']}天({h['rate']}%)"
                            for h in s["habits"][:8]))
    if s.get("habits_note"):
        L.append(f"习惯打卡:{s['habits_note']}")
    w = s["workouts"]
    L.append(f"训练:有氧{w['cardio_count']}次,力量{w['strength_count']}次"
             + (f",其他{w['other_count']}次" if w.get("other_count") else "")
             + f",合计约{w['per_week']}次/周")
    if w.get("insufficient"):
        L.append(f"训练:{w['insufficient']}")
    return "\n".join(L)


def _mask(text, key):
    """防止密钥意外出现在任何对外文本里。"""
    if key and key in text:
        text = text.replace(key, key[:6] + "****")
    return text


async def stream_report(days):
    """async generator:yield {"delta"} / {"error"} / {"done", "report_id"} 事件。"""
    cfg = store.get_meta("ai") or {}
    api_key = cfg.get("api_key") or ""
    if not api_key:
        yield {"error": "尚未配置AI Key:请到 设置→AI识别 填写后保存再试"}
        return

    days = max(1, min(int(days), 365))
    summary = build_summary(days)
    prompt = (f"请基于以下真实统计数据,生成本次健康分析报告(统计窗口:最近{days}天)。\n\n"
              + _summary_text(summary)
              + "\n\n只输出报告正文(固定四节 markdown),不要复述数据清单,不要输出思考过程。")
    model = cfg.get("coach_model") or DEFAULT_COACH_MODEL
    base = (cfg.get("base_url") or DEFAULT_BASE).rstrip("/")
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                     {"role": "user", "content": prompt}],
        "stream": True,
        "temperature": 0.6,
        "max_tokens": 2048,
        "thinking": {"type": "enabled"},
        "reasoning_effort": "low",
    }
    headers = {"Authorization": "Bearer " + api_key}

    report_id = str(uuid.uuid4())
    chunks = []
    try:
        timeout = httpx.Timeout(120.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", base + "/chat/completions",
                                     json=payload, headers=headers) as r:
                if r.status_code != 200:
                    body = (await r.aread()).decode("utf-8", "replace")
                    yield {"error": _mask(f"大模型接口返回{r.status_code}:{body[:300]}", api_key)}
                    return
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = json.loads(data)
                    except ValueError:
                        continue
                    # 只转发正文增量;delta.reasoning_content(思考串)一律忽略
                    delta = (((obj.get("choices") or [{}])[0].get("delta") or {})
                             .get("content"))
                    if delta:
                        chunks.append(delta)
                        yield {"delta": delta}
    except Exception as e:
        yield {"error": _mask(f"调用大模型失败:{e}", api_key)}
        return

    content = "".join(chunks)
    if not content.strip():
        yield {"error": "模型未返回正文内容(只有思考串或空响应),请稍后重试"}
        return
    store.upsert_doc("coach_reports", report_id,
                     {"at": store.now_iso(), "days": days,
                      "content": content, "model": model},
                     store.now_iso(), False, "coach")
    yield {"done": True, "report_id": report_id}
