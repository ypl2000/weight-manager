# GLM-5.3-Flash 接口调研

> 调研员B · 2026-10-25 · 服务于迭代2（AI 教练）。用户已指定 AI 教练模型用 GLM-5.3-Flash。此为调研员交付原文，PM 存档入库。

## 模型标识与调用方式（含与 OpenAI SDK 兼容性结论）

**结论：开放平台 API 的模型 id 就是小写字符串 `glm-5.3-flash`**，与 ZCode/编程平台内部标识 `account:bigmodel-individual-coding-plan/GLM-5.3-Flash` 是两回事。官方模型详情页原文："Model Code: `glm-5.3-flash`/`glm-5.3-flashx`/`glm-5.3-flashx-legal`"；API 参考的视觉模型枚举中也原样列出 `glm-5.3-flash, glm-5.3-flashx, glm-5v-turbo, glm-4.6v, ...`。

- **端点**：`POST https://open.bigmodel.cn/api/paas/v4/chat/completions`，HTTP Bearer 鉴权（API Key 在开放平台 API Keys 页获取）——与现有 glm-4v-plus 接入方式完全一致，无需改 base_url。
- **OpenAI SDK 兼容性**：官方文档未明确声明"OpenAI 兼容"，但请求/响应结构（messages、choices、tool_calls、usage、流式 `data: [DONE]`）与 OpenAI 格式一致；且本项目已用 openai python sdk 指向该 base_url 成功调用 glm-4v-plus，属实证兼容。智谱特有参数（`thinking`、`reasoning_effort`、`do_sample`、`tool_stream`）需通过 `extra_body` 传入。
- **重要**：Coding Plan 套餐**不能**用于自建应用调 API，见"计费"。

## 能力清单（逐项标注来源）

| 能力 | 结论 | 来源 |
|---|---|---|
| 流式输出 | **支持**。`stream=true` 返回 SSE（`text/event-stream`），chunk 含 `delta.content` 与 `delta.reasoning_content`（思考内容），以 `data: [DONE]` 结束 | 对话补全 API 参考 |
| 上下文窗口 | **1M tokens，最大输出 128K**（`max_tokens` 1–131072） | 模型概览 + glm-5.3-flash 文档页 |
| 图片输入 | **支持**。glm-5.3-flash 是原生多模态模型，输入模态含图像/视频/文本/文件；在 `messages[].content[]` 加 `type: image_url` 块，支持图片 URL 或 Base64 Data URL，可多图 | glm-5.3-flash 文档页（vlm 目录） |
| Function calling | **支持**。视觉模型中"仅限 GLM-5.3-Flash 系列、GLM-4.6V、AutoGLM-Phone 支持 tools"；但 `tool_choice` 参数仅 GLM-4.6V 支持。流式工具调用需同时 `stream=true` + `tool_stream=true` | 对话补全 API 参考 |
| JSON mode | **`response_format` 不适用于 glm-5.3-flash**。文档原文："仅文本模型支持此字段"（`{type: text \| json_object}`），且不支持 `json_schema`。glm-5.3-flash 在 API schema 中归类为视觉模型 → **只能靠 prompt 约定 JSON 输出 + 自行解析容错**（现有 recognize.py 已是这个模式）。注意模型页宣传"支持结构化输出"指能力层面，API 参数层面无 `response_format` | 对话补全 API 参考（与模型页存在表述差异，以 API schema 为准） |
| 思考模式 | `thinking.type` **仅支持 `enabled`，不可关闭**；思考强度由 `reasoning_effort` 控制，glm-5.3-flash 仅支持 `low/high/max`（默认 `max`） | API 参考 |
| temperature | 范围 **[0.0, 1.0]**（与 OpenAI 的 0–2 刻度不同）；`top_p` [0.01, 1.0] 默认 0.95；官方建议 temperature=1、top_p=0.95、reasoning_effort=max，且"不建议同时调整 temperature 和 top_p" | API 参考 + 模型页 |

## 计费（人民币/百万 tokens）

| 模型 | 输入 | 输出 | 缓存命中 |
|---|---|---|---|
| **GLM-5.3-Flash** | **0.8** | **2.8** | 0.23 |
| GLM-5.3-FlashX | 2 | 7 | 0.57 |
| GLM-5.3 | 8 | 28 | 2 |

- 缓存存储限时免费。
- 完全免费的替代品（非 5.3 系列）：`glm-4.7-flash`（200K 上下文）、`glm-4.5-flash`、视觉类 `glm-4.6v-flash` 等。
- **Coding Plan 与 API 额度的关系（关键）**：官方 FAQ 原文——"在除规定工具外调用 API，不可享用 Coding 套餐的额度"，自建应用需使用"标准 API 服务，并根据对应协议计费"。即 ZCode 里用的 `GLM-5.3-Flash` 套餐额度**不能**给我们的 FastAPI 后端用；AI 教练走开放平台 API 需要独立充值/资源包。套餐额度机制为"每 5 小时限额 + 每周限额"，仅限官方指定编码工具内使用。

## 对"AI 教练"功能的推荐调用方案

```python
from openai import OpenAI

client = OpenAI(api_key=ZHIPU_API_KEY, base_url="https://open.bigmodel.cn/api/paas/v4")
resp = client.chat.completions.create(
    model="glm-5.3-flash",
    messages=[{"role": "system", "content": SYSTEM_PROMPT},
              {"role": "user", "content": build_health_report_input(days)}],
    stream=True,                      # 周报生成建议流式，前端渐进渲染
    max_tokens=4096,
    extra_body={
        "thinking": {"type": "enabled"},
        "reasoning_effort": "low",    # 默认 max，健康解读用 low 即可，省时省钱
        # temperature=0.8 可选；范围 0-1，不要传 OpenAI 风格的 1.5+
    },
)
```

- 模型 id：`glm-5.3-flash`（如需更快可用 `glm-5.3-flashx`，2/7 元每百万，约 200 tokens/s）。
- 流式注意：chunk 里会先出现 `delta.reasoning_content`（思考过程），前端要过滤，只渲染 `delta.content`。
- 喂多少数据：1M 上下文远超需求——一条日记录约 50–100 tokens，一整年约 2–4 万 tokens，毫无压力。实际建议只喂近 30–90 天明细 + 全量趋势聚合统计（周均值、变化斜率、达成率），控制成本且注意力更聚焦。
- 输出格式：glm-5.3-flash 无 `response_format` JSON mode，采用 **prompt 强约束 JSON schema + 后端容错解析**（正则剥离 ```json 围栏、失败重试一次）。若未来要严格 JSON mode，可切文本模型 `glm-5.3`（支持 response_format，但价格约 10 倍且不支持图片）。
- 成本估算：单次周报约 3K 输入 + 2K 输出 tokens ≈ **0.008 元/次**，计费不构成瓶颈。

## 拍照识别能否统一换用此模型

**技术上可以统一**：glm-5.3-flash 是原生多模态模型，支持 `image_url`（URL/Base64）输入，走同一个端点和同一套 OpenAI SDK 代码，理论上可同时承担拍照识别与文本分析。

**建议保留验证步骤**：现有 glm-4v-plus 是专用视觉模型，体重秤读数识别精度未必弱于这个"文本旗舰衍生"的多模态模型；且专用识别场景若想省钱，免费视觉模型 `glm-4.6v-flash`（128K 上下文）或 `glm-5v-turbo`（200K）也是候选。建议 A/B 对比拍照识别准确率后再决定是否下线 glm-4v-plus；平台还有专门的 GLM-OCR 模型可处理报告类照片。

## 信息可信度说明

- **官方文档直接确认（高可信）**：模型 id、1M 上下文/128K 输出、多模态图片输入、SSE 流式格式、temperature 范围 0–1、thinking 强制开启、`response_format` 仅文本模型、视觉模型 tools 限制、价格、Coding Plan 不可用于自建应用 FAQ。来源：[GLM-5.3-Flash 文档](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash.md)、[GLM-5.3 文档](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)、[模型概览](https://docs.bigmodel.cn/cn/guide/start/model-overview.md)、[定价](https://docs.bigmodel.cn/cn/guide/start/pricing.md)、[对话补全 API 参考](https://docs.bigmodel.cn/api-reference/模型-api/对话补全.md)、[Coding Plan FAQ](https://docs.bigmodel.cn/cn/coding-plan/faq)。
- **实证/合理推断（中高可信）**：openai python sdk 直接兼容（官方未明说，但结构一致 + 本项目 glm-4v-plus 已在用同一接入模式）；"365 天数据约 2–4 万 tokens"为估算。
- **文档间矛盾（已按更权威方裁定）**：模型宣传页称 Flash 支持"结构化输出"，但 API schema 明确 `response_format` 仅文本模型——按"无 JSON mode 参数"设计。
- **未查到**：各档位并发/限速具体数值、新用户赠送额度金额。
