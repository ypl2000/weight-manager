"""图片识别:调用视觉大模型(默认智谱 GLM-4V,兼容 OpenAI vision 接口格式)提取测量数据。

未配置 API Key 时默认走 demo 模式返回固定演示数据,便于先跑通流程;
在 设置→AI识别 里填入 Key 并关闭 demo 即为真实识别。
"""
import base64
import json
import re
import httpx

DEFAULT_BASE = "https://open.bigmodel.cn/api/paas/v4"
DEFAULT_MODEL = "glm-4v-plus"

PROMPT = (
    "你是健康数据录入助手。请从图片中识别健康测量数据(如体重、腰围、臀围、腰臀比、"
    "体脂率、血糖等,可以是体重秤显示屏、体脂秤APP截图、体检报告等)。"
    '只输出一个JSON数组,不要输出任何其他文字。数组每项格式:'
    '{"metric_hint":"指标中文名","value":数值,"unit":"单位","when":"测量日期YYYY-MM-DD,无法确定则为null",'
    '"confidence":0到1的小数,"note":"补充说明或不确定项"}。'
    "若图片中没有可识别的测量数据,输出[]。"
)

DEMO_CANDIDATES = [
    {"metric_hint": "体重", "value": 78.5, "unit": "kg", "when": None,
     "confidence": 0.99, "note": "演示数据(未配置AI Key)"},
    {"metric_hint": "体脂率", "value": 25.1, "unit": "%", "when": None,
     "confidence": 0.97, "note": "演示数据(未配置AI Key)"},
]


def _extract_json(text):
    text = re.sub(r"```(?:json)?|```", "", str(text)).strip()
    m = re.search(r"\[.*\]", text, re.S)
    return json.loads(m.group(0) if m else text)


async def recognize_image(image_bytes, mime, cfg, metric_docs):
    if not cfg.get("api_key"):
        if cfg.get("demo", True):
            return {"demo": True, "candidates": _match(DEMO_CANDIDATES, metric_docs)}
        raise RuntimeError("尚未配置AI Key:请到 设置→AI识别 填写后保存再试")
    base = (cfg.get("base_url") or DEFAULT_BASE).rstrip("/")
    url = base + "/chat/completions"
    b64 = base64.b64encode(image_bytes).decode()
    payload = {
        "model": cfg.get("model") or DEFAULT_MODEL,
        "temperature": 0.1,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            {"type": "text", "text": PROMPT},
        ]}],
    }
    headers = {"Authorization": "Bearer " + cfg["api_key"]}
    async with httpx.AsyncClient(timeout=90) as client:
        r = await client.post(url, json=payload, headers=headers)
        r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    items = _extract_json(content)
    return {"demo": False, "candidates": _match(items, metric_docs)}


def _match(items, metric_docs):
    """把模型给出的指标名模糊匹配到系统已有指标,便于前端预选。"""
    out = []
    for it in items:
        hint = str(it.get("metric_hint", ""))
        matched = None
        for m in metric_docs:
            name = m.get("name", "")
            if name and (name in hint or hint in name):
                matched = m
                break
        out.append({
            "metric_hint": hint,
            "value": it.get("value"),
            "unit": it.get("unit"),
            "when": it.get("when"),
            "confidence": it.get("confidence", 0),
            "note": it.get("note", ""),
            "metric_code": matched.get("code") if matched else None,
            "metric_name": matched.get("name") if matched else None,
            "metric_unit": matched.get("unit") if matched else None,
        })
    return out
