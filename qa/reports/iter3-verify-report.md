# 迭代3（智能洞察 + AI 问答 + 周报回归）验证报告

- 被测：http://127.0.0.1:8000（FastAPI + Vue PWA 体重管理）
- 执行时间：2026-10-26 00:35–01:00（本地时间）
- 执行方式：服务端 API 断言（node fetch，SSE 全量解析）+ Chrome headless CDP 驱动 UI（复用 `qa/tools/cdp.mjs`）
- 测试数据：insights 造数用 qa-rd-* 明显 id（92→85 快降 / 88.0±0.1 平台 / 腰围平与降两种曲线）；问答用真实模型各 1 次 + UI 真点提问 1 次；测后全部清理，基线已恢复（见第 8 项）。
- 本轮新配工具脚本（均为 qa/** 新增，未改动任何业务代码）：`qa/tools/iter3-insights-api.mjs`、`iter3-ask-api.mjs`、`iter3-coach-ui.mjs`、`iter3-shot-coach.mjs`、`iter3-regression.mjs`、`iter3-report-regression.mjs`。

## 结果总览

| # | 项目 | 结果 |
|---|---|---|
| 1 | insights 基线：protein=124g（88.5kg·s1·1.2-1.6） | pass |
| 2 | insights 造数：快降 → rate_alert | pass |
| 3 | insights 造数：平台+腰围平 → true_plateau | pass |
| 4 | insights 造数：腰围在降 → maybe_water | pass |
| 5 | insights 造数清理复原 | pass |
| 6 | ask 错误路径 ×5（空/坏 body/非字符串/空串/超500字） | pass |
| 7 | ask 知识库内问题（引用知识库+用户数据+存档） | pass |
| 8 | ask 知识库外问题（"知识库之外的补充"标注） | pass |
| 9 | coach_qa 测试问答清理 | pass |
| 10 | UI 今日页智能提示卡（蛋白质目标渲染） | pass |
| 11 | UI 教练页问教练卡：真点提问流式渲染 + 问答历史增删 | pass |
| 12 | 周报回归 /api/coach/report days=7 | pass |
| 13 | 回归：记录增删（UI 77.77）/ stage-suggestion / PWA 资源 | pass |
| 14 | 基线核对 | pass |
| | **合计** | **14 pass / 0 fail，无新增缺陷（D4/O4 未启用）** |

---

## 智能洞察 GET /api/insights

### 1) 真实数据基线 — pass
`rate_alert=null`、`plateau=null`、`protein={weight_kg:88.5, stage_id:"s1", range:[1.2,1.6], target_g:124, food_hint:"≈ 鸡胸肉 564g（按每100g约22g蛋白质）", note:"普通阶段按1.2-1.6g/kg(依据知识库·蛋白质)"}`。124 = round(88.5×1.4)（区间中值），与预期一致。

### 2) 快降造数 → rate_alert — pass
造 5 点体重（12 天内 92→85，qa-rd-f0..f4）。合成斜率 `weekly_loss_kg=2.33` > 上限 `0.85kg/周`（取 1kg/周 与 体重1%/周=0.885 的更严值）；文案含"依据知识库·极端节食"、肌肉/骨密度风险与"蛋白质摄入与力量训练"建议；`window_days=14`。同时 `plateau` 保持 null（斜率远超平台阈值，不误报）。

### 3) 平台造数 + 腰围平 → true_plateau — pass
造 8 点体重 88.0±0.1（20 天，qa-rd-p0..p7）+ 4 点腰围 96.0±0.1（qa-rd-aw0..aw3，叠加真实 1 点腰围 96）。返回 `type="true_plateau"`，`weight_slope_per_week=0.04`（|0.04|≤0.15）、`waist_slope_per_week=-0.004`（|x|≤0.2），文案"腰围也走平……热量缺口可能消失"并引用"依据知识库·平台期"。

### 4) 同体重 + 腰围改下降曲线 → maybe_water — pass
删平腰围造数，改 96.5→92.0（qa-rd-dw0..dw3）。返回 `type="maybe_water"`，`waist_slope_per_week=-0.917cm/周`（≤-0.2），文案"假平台/水分潴留"并引用知识库；体重斜率不变。

### 5) 清理复原 — pass
21 个造数 doc 全部 DELETE（cursor=0 全量拉取确认均为 `deleted=true` 墓碑），records 回 8 条，insights 恢复 `rate_alert=null / plateau=null / protein=124`。
> 过程备注：首轮清理脚本漏删 8 条平台体重造数（脚本 bug，非被测系统问题），当即经 API 补删并复核归零，脚本已修正。

## AI 问答 POST /api/coach/ask

### 6) 错误路径 — pass ×5（零模型调用）
| 用例 | error 事件 | 耗时 |
|---|---|---|
| 无 body | `请求体必须是JSON对象` | 4ms |
| 坏 JSON `not-json{{` | `请求体必须是JSON对象` | 16ms |
| `{"question":123}` | `question 必须是字符串` | 20ms |
| `{"question":"   "}` | `question 不能为空` | 3ms |
| 501 字 | `question 长度不能超过500字` | 3ms |

均：单条 error 事件、无 delta/done、秒回（D3 同款"校验前置"模式），事后核对 coach_qa 未新增（不留档）。注：SSE 约定下 HTTP 恒为 200，错误走 error 事件，与 D3 修复口径一致，不计缺陷。

### 7) 知识库内问题 — pass
`"减脂期蛋白质吃多少"`：SSE 200 `text/event-stream`，**318 个 delta / 489 字 / 全程 7.9s**，done 带 `qa_id`，无 error。回答开头即"**按 1.2–1.6 g/kg 体重/天吃**，以你目前约 88.5 kg 计算：下限 ≈106 g/天、中间值 1.5 g/kg ≈133 g/天**(依据知识库·蛋白质)**"，并给出鸡胸肉换算 —— 知识库区间 + 用户数据结合，符合"知识库优先"策略。
存档核对：coach_qa 新增 1 条，`question/answer/model=glm-5.3-flash/device=coach` 齐全，**归档 answer 与流式拼接逐字一致**。

### 8) 知识库外问题 — pass
`"熬夜对减脂的影响"`：361 delta / 576 字 / 8.8s，done 带 qa_id。回答开头第二行即 **"(以下为知识库之外的补充)"** 标注，正文仍按策略在适用处引用知识库并给出个性化建议。

### 9) 清理 — pass
两条测试问答 DELETE 均 200，coach_qa 回到基线 1 条（预存在的"间歇性断食值得做吗"，id a0170c32-…，未动）。

## UI 验证（Chrome headless CDP）

### 10) 今日页智能提示卡 — pass
`#/` 出现"智能提示"卡：`今日蛋白质目标` 小节渲染 **124 g/天**（.protein-num）+ pill `≈ 鸡胸肉 564g（按每100g约22g蛋白质）` + 注释"普通阶段按1.2-1.6g/kg(依据知识库·蛋白质)"。真实数据下无 rate_alert/plateau 横幅（与 API 一致）。截图 `qa/reports/iter3-insights-card.png`。

### 11) 教练页问教练卡 + 问答历史 — pass（真点了"提问"）
- `#/coach` "问教练"卡：textarea（placeholder"问点什么，比如：间歇性断食值得做吗？"）+ `提问` 按钮在线态可用；"问答历史"卡初始 1 条（基线条目）。
- **真点提问**（输入"平台期怎么办"）：按钮转"思考中…约需 15-40 秒"，`.report` 流式渲染实测 **38 个长度快照**（0.26s 出框 → 6.2s 339 字 → 10.8s 645 字完成），答案引用"依据知识库·平台期"并结合用户数据（89.4→88.5、-0.5kg/周、打卡率 3%）；完成后按钮恢复。
- 历史刷新后 **+1**（"Q: 平台期怎么办"在最上），UI 点"删"（confirm 自动确认）→ 列表即时回 1 条，服务端 coach_qa 回基线。截图 `qa/reports/iter3-coach-ask.png`（问教练卡 + 问答历史同框整页）。

## 周报与核心链路回归

### 12) /api/coach/report days=7 — pass
SSE 200，**581 delta / 869 字 / 首帧 1.3s / 全程 13.5s**，done 带 report_id，无 error；归档 `days=7, model=glm-5.3-flash, contentLen=869`；测后已删除归档，coach_reports 回基线 2 条。

### 13) 记录增删 / stage-suggestion / PWA — pass
- **记录增删（UI 全口径）**：`#/data` 录入体重 77.77 → toast"已保存"、列表出现"体重 77.77 kg"行 → 服务端数秒内可见（id 00db0b88-…，value=77.77）→ UI 删除 toast"已删除" → GET 列表消失，cursor=0 拉取确认墓碑 `deleted=true`。
- **stage-suggestion**：`suggested="s1"`、3 个阶段；阶段③腰围规则 `ok=false, detail="当前 96 cm"`。
- **PWA**：`/manifest.webmanifest` 200 (application/manifest+json)、`/sw.js` 200 (text/javascript)、`/icons/icon-192.png` 200 (image/png)；今日页/数据页/教练页均正常渲染无白屏。

### 14) 基线核对 — pass
| 表 | 测试后 | 基线 | 一致 |
|---|---|---|---|
| records 可见 | 8：weight 89.4/89.1/88.9/88.7/88.5、bodyfat 25.8/25.1、waist 96 | 8（同值） | ✓ |
| workouts 可见 | 1 | 1 | ✓ |
| habit_logs 可见 | 2 | 2 | ✓ |
| coach_qa 可见 | 1（a0170c32-…，预存在） | 1 | ✓ |
| coach_reports 可见 | 2（预存在） | 2 | ✓ |
| profile | current_stage_id=s1 | s1 | ✓ |

全表 cursor=0 扫描无任何 qa-* 可见残留；本轮全部痕迹均为墓碑（records 21+8+1 条、coach_qa ×3、coach_reports ×1）。history 审计条目增加属追加式设计预期。

## 缺陷

**无新增缺陷。** D4/O4 未启用，defects.md 本轮无改动。备注两点（均不计缺陷）：① ask 错误路径 HTTP 恒 200、错误走 SSE error 事件，与 D3 已关闭口径一致；② insights 造数首轮清理脚本自身漏删 8 条（QA 工具 bug），已补删并修正脚本，被测系统无恙。

## 截图清单（qa/reports/）
- `iter3-insights-card.png` — 今日页"智能提示"卡（今日蛋白质目标 124 g/天 + 鸡胸肉 564g pill + 知识库注释）
- `iter3-coach-ask.png` — 教练页"问教练"卡 + "问答历史"同框（整页，含基线问答展开态）
