"""首次启动种子数据:全部来自用户的白板截图(苹果型运动 / 内脏脂肪),均可在界面上增删改。"""
import store


def _d(**kw):
    return kw


METRICS = [
    ("m_weight",  _d(code="weight",  name="体重",   unit="kg",     sort=1, active=True, daily=True, thresholds={})),
    ("m_waist",   _d(code="waist",   name="腰围",   unit="cm",     sort=2, active=True, thresholds={"all": 85, "male": 90},
                      note="女≥85 / 男≥90 提示内脏脂肪超标")),
    ("m_hip",     _d(code="hip",     name="臀围",   unit="cm",     sort=3, active=True, thresholds={})),
    ("m_whr",     _d(code="whr",     name="腰臀比", unit="",       sort=4, active=True, thresholds={"all": 0.85, "male": 0.9},
                      note="女>0.85 / 男≥0.9;记录腰围+臀围后可自动计算")),
    ("m_bodyfat", _d(code="bodyfat", name="体脂率", unit="%",      sort=5, active=True, thresholds={})),
    ("m_ppg",     _d(code="ppg",     name="餐后血糖", unit="mmol/L", sort=6, active=True, thresholds={}, note="餐后2小时")),
]

STAGES = [
    ("s1", _d(
        name="阶段① 降糖·稳食欲·降腰围", order=1, color="#f59e0b", active=True,
        summary="四肢细肚子大、饭后犯困、嘴馋、虚弱;或大基数/内脂高。优先:降糖 + 稳食欲 + 降腰围。",
        standards=[
            "腰围超标(女≥85cm / 男≥90cm)或腰臀比超标(女>0.85 / 男≥0.9)",
            "大基数,或暂无规律运动基础",
        ],
        targets=_d(cardio_per_week=3, strength_per_week=2),
        template=[
            "有氧:每周3-4次,每次30-40分钟,强度=能说话不能唱歌",
            "项目选不枯燥+喜欢的:快走 / 骑行 / 游泳等",
            "精力差 → 从散步10/20/30分钟或5000-6000步开始",
            "听反馈:累 → 休息 / 降强度",
            "力量:每次15分钟,重点练动作·发力·呼吸模式,打基础",
            "饮食:控糖 + 稳食欲,按每日清单执行",
        ],
        rules=[],
    )),
    ("s2", _d(
        name="阶段② 过渡期·引入力量", order=2, color="#3b82f6", active=True,
        summary="腰围开始下降、精力改善后,有氧:力量 ≈ 1:1,逐步引入力量训练。",
        standards=[
            "腰围呈下降趋势",
            "精力 / 餐后血糖改善",
            "已建立运动习惯(≥2次/周)",
        ],
        targets=_d(cardio_per_week=3, strength_per_week=3),
        template=[
            "有氧:力量 ≈ 1:1",
            "有氧 → 提升线粒体数量与质量 → 燃脂/产能(精力)",
            "心率60-70%,快慢交替,20-40分钟",
            "强度越大 → 糖供能比例↑ → 运动前后加优质碳水",
            "力量:高位下拉 / 划船 / 俯卧撑 / 深蹲 / 硬拉 / 死虫式",
        ],
        rules=[
            _d(metric="waist", op="trend_down", agg="trend_down", window_days=14),
            _d(metric="workouts", op="freq_gte", value=2, window_days=14),
        ],
    )),
    ("s3", _d(
        name="阶段③ 增肌塑形·力量为主", order=3, color="#10b981", active=True,
        summary="腰围达标、心肺与肌耐力建立后,力量训练为主,二分化/三分化,渐进超负荷。",
        standards=[
            "腰围达标(女<85cm / 男<90cm)",
            "心肺 / 肌耐力基础建立",
            "运动与恢复状态良好",
        ],
        targets=_d(cardio_per_week=2, strength_per_week=4),
        template=[
            "力量为主:二分化或三分化",
            "框架考虑:时间投入 · 恢复能力 · 发展目标(上肢?臀腿?)",
            "渐进超负荷:逐步加重量或次数",
            "有氧保持每周2-3次,维持线粒体与心肺",
        ],
        rules=[
            _d(metric="waist", op="lte", agg="latest", value=_d(all=85, male=90), window_days=14),
            _d(metric="workouts", op="freq_gte", value=3, window_days=14),
        ],
    )),
]

HABITS = [
    ("h_d1", _d(name="三餐规律·不乱加餐", category="diet", sort=1, active=True, note="→ 胰岛素敏感性")),
    ("h_d2", _d(name="蔬菜量 ≥ 主食+肉", category="diet", sort=2, active=True, note="→ 纤维·抗氧化")),
    ("h_d3", _d(name="蛋白质以白肉为主(鸡鸭鱼虾)", category="diet", sort=3, active=True)),
    ("h_d4", _d(name="拒绝包装深加工食品", category="diet", sort=4, active=True)),
    ("h_d5", _d(name="控糖:无奶茶/含糖饮料", category="diet", sort=5, active=True, note="隐藏人群:体重正常四肢细→奶茶/外卖/熬夜")),
    ("h_d6", _d(name="Omega平衡:深海鱼或坚果", category="diet", sort=6, active=True, note="→ 平衡Omega-6/3比例")),
    ("h_s1", _d(name="睡满7-8小时", category="sleep", sort=1, active=True, note="→ 皮质醇昼夜节律")),
    ("h_s2", _d(name="4-7-8呼吸练习", category="sleep", sort=2, active=True, note="→ 激活副交感神经")),
    ("h_s3", _d(name="少刷手机(刷手机≠放松)", category="sleep", sort=3, active=True, note="→ 减少信息输入,不要完美主义")),
    ("h_m1", _d(name="完成今日计划运动", category="motion", sort=1, active=True)),
]

EXERCISES = [
    ("e_c1", _d(name="快走", type="cardio", active=True)),
    ("e_c2", _d(name="骑行", type="cardio", active=True)),
    ("e_c3", _d(name="游泳", type="cardio", active=True)),
    ("e_c4", _d(name="散步", type="cardio", active=True, note="精力差时从10/20/30分钟开始")),
    ("e_c5", _d(name="慢跑", type="cardio", active=True)),
    ("e_s1", _d(name="高位下拉", type="strength", active=True)),
    ("e_s2", _d(name="划船", type="strength", active=True)),
    ("e_s3", _d(name="俯卧撑", type="strength", active=True)),
    ("e_s4", _d(name="深蹲", type="strength", active=True)),
    ("e_s5", _d(name="硬拉", type="strength", active=True)),
    ("e_s6", _d(name="死虫式", type="strength", active=True, note="打基础:动作·发力·呼吸模式")),
]

PROFILE = _d(gender="", height_cm=None, birthday="", current_stage_id="s1",
             target_weight=None, target_waist=None)

AI_SETTINGS = _d(base_url="https://open.bigmodel.cn/api/paas/v4", model="glm-4v-plus",
                 api_key="", demo=True)


def seed_if_empty():
    if store.get_all("profile"):
        return
    now = store.now_iso()
    for doc_id, data in METRICS:
        store.upsert_doc("metrics", doc_id, data, now, False, "seed", force=True)
    for doc_id, data in STAGES:
        store.upsert_doc("stages", doc_id, data, now, False, "seed", force=True)
    for doc_id, data in HABITS:
        store.upsert_doc("habits", doc_id, data, now, False, "seed", force=True)
    for doc_id, data in EXERCISES:
        store.upsert_doc("exercises", doc_id, data, now, False, "seed", force=True)
    store.upsert_doc("profile", "me", PROFILE, now, False, "seed", force=True)
    store.set_meta("ai", AI_SETTINGS)
