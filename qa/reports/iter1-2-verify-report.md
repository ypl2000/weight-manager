# 迭代1(数据导入) + 迭代2(AI 教练) 验证报告

- 被测：http://127.0.0.1:8000（FastAPI + Vue PWA 体重管理）
- 执行时间：2026-10-25 23:40–24:10（本地时间）
- 执行方式：服务端 API 断言（curl/node fetch）+ Chrome headless CDP 驱动 UI（复用 `qa/tools/cdp.mjs`，`Runtime.evaluate` 内 `el.click()` + `DOM.setFileInputFiles` 注入本地文件，规避后台节流）。
- 测试数据：导入用 77.77 kg / 2027-01-05、2027-01-06 明显值；测试后全部清理，基线已恢复（见第 9 项）。
- 本轮新配工具脚本：`qa/tools/iter1-settings-import.mjs`、`iter1-commit-ui.mjs`、`iter1-shot.mjs`、`iter2-coach-api.mjs`、`iter2-coach-ui.mjs`、`iter2-coach-nobody.mjs`、`iter2-entry-shot.mjs`、夹具 `qa/tools/import-test.csv`（均为 qa/** 新增，未改动任何业务代码）。

## 结果总览

| # | 项目 | 结果 |
|---|---|---|
| 1 | 三种夹具 preview | pass |
| 2 | commit 幂等（imported=2 → 0） | pass |
| 3 | 设置页导入分区 UI（展开/预览/离线禁用/提交） | pass |
| 4 | 导入测试数据清理 | pass |
| 5 | coach API days=7 流式 + 归档 | pass |
| 6 | #/coach UI（入口卡/渲染/历史/真点生成/删除） | pass |
| 7 | coach 缺 body 错误路径 | **fail（轻微）→ D3** |
| 8 | 回归（记录增删 / stage-suggestion / PWA） | pass |
| 9 | 基线核对 | pass |
| | **合计** | **8 pass / 1 fail（轻微）** |

---

## 迭代1 数据导入

### 1) 三种夹具 preview — pass ×3
均 `POST /api/import/preview`（multipart）：

| 夹具 | format | total | skipped | mapped_columns | 关键校验点 |
|---|---|---|---|---|---|
| export.zip | apple_health | 3 | 0 | HKQuantityTypeIdentifierBodyMass→weight、…BodyFatPercentage→bodyfat、…WaistCircumference→waist | 体脂 0.213→**21.3**（×100，带 warning）；StepCount 记录正确忽略 |
| huawei.json | huawei_json | 2 | 0 | bodyWeight→weight、bodyFatRate→bodyfat | 毫秒时间戳 1768903800000→2026-01-20T10:10:00Z；0.228→**22.8**（×100）；HEART_RATE 点忽略 |
| chinese.csv | csv | 4 | 2 | 体重/kg→weight、体脂率/%→bodyfat、腰围/cm→waist | 斜杠日期 `2026/10/22 7:45` 正常解析；999 超范围丢弃并带 warning；坏时间行"不是日期"整行跳过 |

### 2) commit 幂等 — pass
自造 2 行 CSV（`时间,体重/kg`，77.77，2027-01-05/06 08:00，`qa/tools/import-test.csv`）：
- preview：`format=csv, total=2`，时间正确转 `2027-01-05/06T00:00:00Z`（UTC+8 口径）。
- commit #1：`{"imported":2,"skipped":0}`；服务端出现 `imp_weight_1799107200` / `imp_weight_1799193600`，`source=import, note=批量导入, unit=kg`。
- commit #2（同内容）：`{"imported":0,"skipped":2}` —— **幂等符合设计（首写优先，确定性 id）**。
- 附加守卫：`{"rows":"x"}` → 400 `rows 必须是数组`。

### 3) 设置页导入分区 UI — pass（全流程 UI 走通）
- 分区"批量导入历史数据"可展开，含说明文案与 `accept=".zip,.csv,.txt,.json"` 文件选择框（在线态可用）。
- **文件选择 → 预览真实渲染**：经 CDP `DOM.setFileInputFiles` 注入 import-test.csv，出现预览卡：chip `CSV`、`共 2 行`、列映射 pill `体重/kg → 体重`、2 行 77.77 明细表、按钮 `确认导入全部 2 行`/`取消`。截图 `qa/reports/iter1-import-section.png`。
- **UI 点击"确认导入全部 2 行"**（重复内容）→ toast `导入 0 条,跳过 2 条`，服务端记录数不变 —— 幂等在 UI 路径同样成立。
- **离线禁用态**：`Network.emulateNetworkConditions(offline)` 后重进设置页：`navigator.onLine=false`、文件选择框 `disabled=true`、横幅"当前离线:导入需要联网,请联网后再试。"。截图 `qa/reports/iter1-import-offline.png`。

### 4) 测试数据清理 — pass
`DELETE /api/tables/records/{id}` ×2（imp_weight_1799107200/1799193600）均 200；`/api/sync cursor=0` 全量拉取确认两条均为 `deleted=true` 墓碑，GET 列表不再出现。

---

## 迭代2 AI 教练

### 5) coach API days=7 — pass
`POST /api/coach/report {"days":7}`：
- `HTTP 200, text/event-stream`；**471 个 delta 事件、660 字正文**，首个 delta 1248ms，全程 13.1s；
- 结束帧 `{"done":true,"report_id":"c8b1dee7-915a-47e6-9633-91604be60743"}`，无 error 事件；
- coach_reports 可见 2 → **3**；归档内容核对：`days=7, model=glm-5.3-flash, device=coach`，正文含固定四节（趋势解读/亮点/风险/下周建议），引用真实数据（88.7→88.5、25.8→25.1、96cm）且对数据不足处如实标注。

### 6) #/coach UI — pass（真点了"生成"）
- **今日页入口卡**：`🤖 AI 教练解读 / 基于近期体重与打卡数据,生成 AI 阶段报告 / 进入 →`（链接 `#/coach`）存在。截图 `qa/reports/iter2-today-entry.png`。
- **教练页初始态**：h1 `🤖 AI 教练`、窗口 chips 近7天/近30天/近90天、`生成 AI 解读`按钮可用、历史列表 3 条（含 5) 生成的近7天报告，标注 `· glm-5.3-flash`）。截图 `qa/reports/iter2-coach-page.png`。
- **历史展开**：点开近7天报告 → 四节内容完整渲染（趋势解读/亮点/风险/下周建议 均 true）。
- **真点"生成 AI 解读"（近30天）**：流式渲染实测 —— `.report` 文本长度随时间增长共 **53 个快照**（如 7.4s 时 406 字 → 14.2s 时 776 字），完成后 toast `解读完成` 路径走通（历史自动刷新 +1）；生成期间按钮禁用并显示"生成中…(含思考约需 30-60 秒)"。
  - 测量备注：探测脚本首个快照 660 字系选择器命中了已展开的历史内容 div（该 div 同名 class `report`，Coach.vue L56），随后切换到真正的生成框，非内容回退。
- **历史删除**：UI 点"删"（confirm 自动确认）→ 列表即时移除、toast `已删除`，服务端转墓碑。
- 生成结束后教练页生成的报告与 5) 的报告均已清理（见第 9 项）。

### 7) 错误路径（缺 body）— **fail（轻微）→ 缺陷 D3**
- `POST /api/coach/report` 三种坏请求（无 body / `not-json{{` / `{"days":"abc"}`）：**均返回 200 并开始按默认 30 天真实生成**（实测收到连续 delta），而非期望的 400 或 error 事件。
- 缓解面：**无 500**；客户端断开后服务端生成被取消，**不留归档**（实测 coach_reports 数量不变）。详见 defects.md D3。

---

## 回归与收尾

### 8) 回归冒烟（抽核心链路）— pass
- **stage-suggestion**：`suggested="s1"`，3 个阶段；阶段③规则 ok=false，detail `当前 96 cm`、`实际约 0.5 次/周(共1天有打卡)`。
- **记录增删**（/api/sync 写 + DELETE，同 UI 口径）：创建 77.77 → 可见 9 且值正确；删除 → 可见回 8，cursor=0 拉取确认墓碑 `deleted=true`。
- **PWA 资源**：`/manifest.webmanifest` 200 (application/manifest+json)、`/sw.js` 200 (text/javascript)、`/icons/icon-192.png` 200 (image/png)。
- 本轮 UI 操作（设置页/教练页/今日页）均正常加载渲染，无白屏。

### 9) 基线核对 — pass
| 表 | 测试后 | 基线 | 一致 |
|---|---|---|---|
| records 可见 | 8：weight 89.4/89.1/88.9/88.7/88.5、bodyfat 25.8/25.1、waist 96 | 8 | ✓ |
| workouts 可见 | 1（快走 35min） | 1 | ✓ |
| habit_logs 可见 | 2（h_d1、h_s1 done=1） | 2 | ✓ |
| coach_reports 可见 | 2（两条预存在的近30天报告，非本轮产生） | 2（预存在） | ✓ |

本轮全部痕迹均为墓碑：`imp_weight_1799107200/1799193600`、`qa-reg-*`、coach_reports ×2（API days=7 与 UI days=30 各一）。测试期间曾观测今日页"上次:77.77 kg · 01/06 08:00"短暂陈旧显示（服务端删除后、本端同步前），重新加载+同步后自愈为 88.5 —— 离线优先的最终一致性表现，记观察项 O3，不计缺陷。

## 截图清单（qa/reports/）
- `iter1-import-section.png` — 设置页"批量导入历史数据"展开态 + CSV 预览（2 行 77.77、列映射、确认导入按钮）
- `iter1-import-offline.png` — 导入分区离线禁用态（input disabled + 离线横幅）
- `iter2-coach-page.png` — 教练页初始态（生成按钮/近7·30·90天 chips/历史 3 条）
- `iter2-today-entry.png` — 今日页"🤖 AI 教练解读"入口卡
