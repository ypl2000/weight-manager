# 迭代3 收官审计报告

> 监督员 · 2026-10-26 · PM 存档入库。

**审计人**：监督员（只读） | **方式**：git log 核对 + 代码抽查 + QA 报告/截图核验 + 本地服务独立实测

## 结论：**通过**

迭代3交付声明与实际改动一致，QA 14/14 有报告与截图支撑，服务实测（insights 蛋白质有值、ask 空问题 47ms 返回 SSE error 零模型消耗、coach_qa 有存档且回答引用知识库）全部符合预期。发现 2 处轻微偏差（不阻塞收官），1 处历史备注。

## DoD 核查表

| # | DoD 项 | 证据 | 判定 |
|---|---|---|---|
| 1 | QA 14/14 通过 | qa/reports/iter3-verify-report.md（8.9KB）：14 项逐条 pass，含三规则造数（快降→rate_alert、腰围平→true_plateau、腰围降→maybe_water）、ask 错误路径×5（3-20ms 秒回）、知识库内/外双向验证、UI 真点提问 38 个流式快照、回归、基线复原核对表 | ✓ |
| 2 | 视觉验收 fail→修复→复验 pass | 首轮 iter3-coach-ask.png（00:43）→ 修复提交 1c0578e → 复验 iter3-coach-ask-fixed.png（00:55）；Coach.vue renderMd 先转义（esc）再做标题/加粗/列表转换，防注入到位 | ✓ |
| 3 | 后端交付 | backend/insights.py 三规则纯规则实现（阈值常量+知识库出处文案）；backend/coach.py KB_PATH 指向 docs/知识汇总-整理版.md，正文全文注入系统提示词（截到错别字对照表前），STRATEGY_PROMPT 明确"优先依据知识库并注明出处章节"与"(以下为知识库之外的补充)"；/api/coach/ask 校验前置（main.py）+ stream_ask 写 coach_qa 表 | ✓ |
| 4 | 前端交付 | Today.vue 智能提示卡（消费 /api/insights）；Coach.vue 问教练卡/问答历史（增删）/renderMd | ✓ |
| 5 | PM 集成 + 提交岗位标注 | 实测 8000 端口三接口通过；迭代3 三提交均带岗位前缀且与改动吻合：e6c8e0e [后端][前端]、4adc253 [QA][PM]、1c0578e [前端][QA][PM] | ✓ |
| 6 | README 说明（上轮 B2 闭环） | "问教练"（知识库优先+出处+库外标注）、"智能提示"（速率警告/真假平台期/蛋白质目标）均已写入 | ✓ |
| 7 | 监督员审计 | 即本报告 | ✓ |

## 服务实测记录

① GET /api/insights → protein.target_g=124（88.5kg·s1·区间中值），与 QA 基线一致；② POST /api/coach/ask {"question":"   "} → 47ms 返回 data: {"error": "question 不能为空"}，无 delta/done，零模型消耗；③ GET /api/tables/coach_qa → 基线 1 条存档，answer 含"依据知识库·进餐频率"。

## 越权与偏差清单

未发现越权。两处轻微偏差（记录在案，不要求返工）：

1. **轻微 | 提交边界混杂**：1c0578e 混入根目录新文件 知识汇总.md（原始口播稿素材，与注入源 docs/知识汇总-整理版.md 内容重复），非前端/QA 产物，与提交主题不符。数据所有者已确认保留整理版入库；原始稿随 [PM] 收口提交处理归属
2. **轻微 | 复验结论未回写 QA 报告**：iter3-verify-report.md 定稿于修复前，复验结论只存在于提交信息与文件名中——PM 已按建议 1 回写"复验记录"小节

## 新岗位申请

无。

## 流程改进建议（PM 已全部采纳）

1. 复验结论回写机制：视觉/UI 验收 fail 后的修复复验，应在 QA 报告追加"复验记录"小节——已执行
2. 资料文件单独提交（[PM] 资料 标注）——自下轮执行
3. SSE 接口约定文档化——已写入 README 接口约定段
