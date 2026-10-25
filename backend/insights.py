"""智能洞察(迭代3):三条纯规则、可解释的健康提示,不调模型。

规则依据 docs/知识汇总-整理版.md:
  - rate_alert  快速减重警示:最近14天体重≥4点且最小二乘斜率换算降幅 >1kg/周
                (或 >1%当前体重/周,取更严)→ 肌肉与骨密度流失风险(知识库·极端节食)
  - plateau     平台期分型:最近21天体重≥4点且 |斜率|≤0.15kg/周 → 候选;
                腰围≥3点且走平(|斜率|≤0.2cm/周)→ true_plateau(缺口消失);
                腰围数据不足或仍在降 → maybe_water(水分潴留)(知识库·平台期)
  - protein     每日蛋白质参考:普通 1.2-1.6g/kg,阶段③力量为主 1.6-2.2g/kg,
                目标取区间中值,按鸡胸肉22g蛋白/100g换算食物量(知识库·蛋白质/高蛋白+力量训练)

斜率复用 coach._slope_per_day(按时间轴的最小二乘,不等间隔数据也准确),×7 换算每周。
"""
import datetime as dt

import coach
import store

# ---- 速率告警 ----
RATE_WINDOW_DAYS = 14
RATE_MIN_POINTS = 4
RATE_MAX_KG_PER_WEEK = 1.0
RATE_MAX_FRACTION_PER_WEEK = 0.01  # 1% 当前体重/周

# ---- 平台期分型 ----
PLATEAU_WINDOW_DAYS = 21
PLATEAU_WEIGHT_MIN_POINTS = 4
PLATEAU_MAX_KG_PER_WEEK = 0.15
PLATEAU_WAIST_MIN_POINTS = 3
PLATEAU_MAX_CM_PER_WEEK = 0.2

# ---- 蛋白质 ----
PROTEIN_RANGE_NORMAL = (1.2, 1.6)
PROTEIN_RANGE_STRENGTH = (1.6, 2.2)  # 阶段③力量为主
STRENGTH_STAGE_ID = "s3"
CHICKEN_BREAST_PROTEIN_G_PER_100G = 22.0


def _points(records, code, days, now):
    """窗口内( days=None 表示不限窗口)某指标的 (时刻, 值) 序列,按时间升序。"""
    cut = None if days is None else now - dt.timedelta(days=days)
    pts = []
    for r in records:
        if r.get("metric_code") != code:
            continue
        at = coach._parse(r.get("at"))
        if not at or (cut is not None and at < cut):
            continue
        try:
            pts.append((at, float(r.get("value"))))
        except (TypeError, ValueError):
            pass
    pts.sort(key=lambda x: x[0])
    return pts


def _slope_per_week(pts):
    s = coach._slope_per_day(pts)
    return None if s is None else s * 7


def rate_alert(records, now):
    """快速减重警示;数据不足或速率正常返回 None。"""
    pts = _points(records, "weight", RATE_WINDOW_DAYS, now)
    if len(pts) < RATE_MIN_POINTS:
        return None
    slope = _slope_per_week(pts)
    if slope is None:
        return None
    weekly_loss = -slope  # 体重下降记为正
    current = pts[-1][1]
    if current <= 0:
        return None
    # 两条上限取更严(更小)者;超过即告警
    threshold = min(RATE_MAX_KG_PER_WEEK, RATE_MAX_FRACTION_PER_WEEK * current)
    if weekly_loss <= threshold:
        return None
    return {
        "weekly_loss_kg": round(weekly_loss, 2),
        "window_days": RATE_WINDOW_DAYS,
        "message": (f"最近{RATE_WINDOW_DAYS}天减重约{weekly_loss:.2f}kg/周,超过安全上限"
                    f"{threshold:.2f}kg/周(取1kg/周与体重1%/周的更严值)。依据知识库·极端节食:"
                    f"减重速率超过1kg/周,肌肉和骨密度流失风险显著升高(快速减肥组瘦体重流失约为"
                    f"慢速组的3倍,髋部骨密度流失也更明显)。减肥是马拉松,不是越快越好:"
                    f"建议缩小热量缺口、放慢速率,并保证蛋白质摄入与力量训练。"),
    }


def plateau(records, now):
    """平台期分型;体重数据不足或体重仍在明显下降(非平台)返回 None。"""
    wpts = _points(records, "weight", PLATEAU_WINDOW_DAYS, now)
    if len(wpts) < PLATEAU_WEIGHT_MIN_POINTS:
        return None
    wslope = _slope_per_week(wpts)
    if wslope is None or abs(wslope) > PLATEAU_MAX_KG_PER_WEEK:
        return None
    apts = _points(records, "waist", PLATEAU_WINDOW_DAYS, now)
    aslope = _slope_per_week(apts) if len(apts) >= PLATEAU_WAIST_MIN_POINTS else None
    weight_txt = f"最近{PLATEAU_WINDOW_DAYS}天体重几乎走平(斜率约{wslope:+.2f}kg/周)"

    if aslope is not None and aslope <= -PLATEAU_MAX_CM_PER_WEEK:
        # 腰围仍在降:脂肪在减少,体重不动大概率是水分掩盖 → 假平台
        return {"type": "maybe_water",
                "weight_slope_per_week": round(wslope, 3),
                "waist_slope_per_week": round(aslope, 3),
                "message": (f"{weight_txt},但腰围仍在下降(约{aslope:+.2f}cm/周)——更可能是假平台:"
                            f"水分潴留掩盖了脂肪减少(吃咸/碳水吃多/生理期/运动炎症储水)。"
                            f"依据知识库·平台期:脂肪一天可能只减几十克,水分波动能到几百克甚至几公斤,"
                            f"不要只盯短期体重,看长期趋势和腰围即可。")}
    if aslope is not None and abs(aslope) <= PLATEAU_MAX_CM_PER_WEEK:
        # 体重、腰围双走平 → 真平台
        return {"type": "true_plateau",
                "weight_slope_per_week": round(wslope, 3),
                "waist_slope_per_week": round(aslope, 3),
                "message": (f"{weight_txt},腰围也走平(约{aslope:+.2f}cm/周)——更可能是真平台:"
                            f"热量缺口可能消失。依据知识库·平台期:体重下降后代谢随之下降属正常生理现象;"
                            f"更常见的是饮食依从性不知不觉下滑,热量估算普遍被低估25%-50%。"
                            f"建议复盘饮食记录\"查账\",热量往高了估,在下一周期优化。")}
    if aslope is not None:
        # 腰围明显上升(> +0.2cm/周):缺口必然已消失,按真平台提示(规范未覆盖的残余分支)
        return {"type": "true_plateau",
                "weight_slope_per_week": round(wslope, 3),
                "waist_slope_per_week": round(aslope, 3),
                "message": (f"{weight_txt},腰围反而在上升(约{aslope:+.2f}cm/周)——热量缺口大概率已经消失,"
                            f"且并非水分问题。依据知识库·平台期:更常见的是饮食依从性不知不觉下滑,"
                            f"热量估算普遍被低估25%-50%。建议立刻复盘饮食记录\"查账\",热量往高了估。")}
    # 腰围数据不足 → 先按假平台提示,并引导补测腰围
    return {"type": "maybe_water",
            "weight_slope_per_week": round(wslope, 3),
            "waist_slope_per_week": None,
            "message": (f"{weight_txt},但腰围数据不足,暂无法分型——可能是水分潴留"
                        f"(吃咸/碳水吃多/生理期/运动炎症储水)掩盖了脂肪减少。依据知识库·平台期:"
                        f"看长期趋势和腰围;建议近期补测腰围,以便区分真假平台。")}


def protein(records, profile):
    """每日蛋白质参考量;无任何体重数据返回 None。"""
    pts = _points(records, "weight", None, None)
    if not pts:
        return None
    weight = pts[-1][1]
    stage_id = (profile or {}).get("current_stage_id")
    if stage_id == STRENGTH_STAGE_ID:
        lo, hi = PROTEIN_RANGE_STRENGTH
        note = f"阶段③力量为主按{lo}-{hi}g/kg(依据知识库·高蛋白+力量训练)"
    else:
        lo, hi = PROTEIN_RANGE_NORMAL
        note = f"普通阶段按{lo}-{hi}g/kg(依据知识库·蛋白质)"
    target_g = round(weight * (lo + hi) / 2)
    chicken_g = round(target_g / CHICKEN_BREAST_PROTEIN_G_PER_100G * 100)
    return {"weight_kg": round(weight, 2), "stage_id": stage_id,
            "range": [lo, hi], "target_g": target_g,
            "food_hint": f"≈ 鸡胸肉 {chicken_g}g（按每100g约22g蛋白质）",
            "note": note}


def build():
    now = dt.datetime.now(dt.timezone.utc)
    records = [d["data"] for d in store.get_all("records")]
    profile = (store.get_doc("profile", "me") or {}).get("data", {})
    return {
        "rate_alert": rate_alert(records, now),
        "plateau": plateau(records, now),
        "protein": protein(records, profile),
    }
