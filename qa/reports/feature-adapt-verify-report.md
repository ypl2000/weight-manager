# 全量功能 + 双端适配验证报告（清单逐项 + 36 格适配矩阵）

- 被测：http://127.0.0.1:8000（FastAPI + Vue3 PWA 体重管理，**pythonw 常驻交付实例 PID 16448，QA 全程未杀进程/未重启**）
- 执行时间：2026-11-01 22:58 – 2026-11-02 00:00（本地时间；执行中途跨过 UTC+8 零点，日期相关断言按当天动态推算，见"执行注记"）
- 执行方式：服务端 API 断言（node fetch）+ Chrome headless CDP 驱动 UI/DOM 断言。适配矩阵全部以 getBoundingClientRect / computed style 量取判定，截图仅存档参考（fullPage 截图会把 fixed 底栏画在展开视口底/中造成伪影，已知成像方式，不作为判定依据）
- 清单：`qa/feature-checklist.md`（本轮补"执行注记"4 条）；结果数据：`qa/reports/vf-api-results.json`、`vf-ui-results.json`、`vf-matrix-results.json`
- 测试数据：77.77 等明显值，id `qa-vf-*` / `imp_*`（导入确定性 id）+ 真实模型识别候选 1 条；测后全部软删清理
- 本轮新增工具（均在 qa/**，未改任何业务代码）：`vf-api.mjs`、`vf-coach.mjs`、`vf-ui.mjs`、`vf-matrix.mjs`、`vf-mkpng.mjs`（生成模拟秤屏截图）、`vf-chart-evidence.mjs`、`vf-habit-probe.mjs`

## 结果总览

| 段 | 结果 | 说明 |
|---|---|---|
| 模块1-8 功能项（API 段 vf-api.mjs） | **38/38 pass** | 记录 CRUD/LWW/拍照识别/三夹具导入/阶段/洞察/提醒/数据安全/PWA |
| 模块4 AI 教练（真实模型 vf-coach.mjs） | **15/16 pass，1 项判 FAIL** | 周报 SSE+存档、坏入参零模型、库内引用、历史管理全过；**库外标注缺失 → 缺陷 D5** |
| 模块1-8 功能项（UI 段 vf-ui.mjs，CDP） | **24/24 pass** | 横幅联动/录入删除/习惯/训练/阶段手动切换/设置分区/导入预览/拍照识别全流程/五页渲染 |
| 模块9 适配矩阵（vf-matrix.mjs） | **36/36 格 pass** | 6 页面 × 6 视口，9 类 DOM 断言 |
| 基线核对 | **pass** | 全表复原，见文末 |

> 统计口径：功能清单逐项共 **78 项断言**（API 38 + 教练 16 + UI 24），**pass 77 / fail 1**（即缺陷 D5）；适配矩阵 **36/36 全 pass**。矩阵首轮曾出现 3 格"设置页两列"误报，系 QA 断言公式漏减 grid gap 14px（修公式后全过，非被测系统问题）。

---

## 一、功能清单逐项结果

### 模块1 记录 — 16/16 pass

| # | 项目 | 结果 | 证据摘要 |
|---|---|---|---|
| R1/R1b | 手动录入 API | pass | PUT ok；GET 可见 value=77.77/unit=kg 字段完整 |
| R2 | 手动录入 UI | pass | toast"已保存"+最近记录行+服务端 ≤8s 可见（实测即时） |
| R3 | 手动编辑 | pass | 同 id 改值 77.78，updated_at 变新 |
| R4 | 手动删除软删 | pass | GET 列表消失（get_all 默认滤墓碑）；/api/sync cursor=0 拉取见墓碑 deleted=true |
| R5 | LWW 新者胜 | pass | 旧 updated_at 推送 applied=1 但值不被回滚（保持 77.78） |
| R6/R6b | 拍照识别配置 | pass | /api/meta/ai：api_key 已配、demo=false、model=glm-5.3-flash；设置页分区含 base_url/模型/Key(密码框)/演示模式开关 |
| R7 | 拍照识别-真实识别 | pass | 合成秤屏图（vf-scale.png，含"77.77"）POST /api/recognize → demo=false，candidate 体重 77.77 置信 0.95-0.99、metric_code 模糊匹配 weight，6-21s |
| R8 | 拍照识别-空图 | pass | 400"图片为空" |
| R9a-c | 拍照识别 UI 全流程 | pass | #/data?tab=camera 选图→预览→开始识别→候选区（可编辑指标/值/日期）→"✓ 确认保存为记录"→ 入库 source=ai value=77.77 → 清理复原 8 条。无演示模式横幅（真实模型态正确） |
| R10/R10b | 导入 chinese.csv preview | pass | format=csv、total=4（坏日期行整行丢弃）、映射 体重/kg→weight、体脂率/%→bodyfat、腰围/cm→waist；0.249→24.9% 小数口径转换；999 超范围剔除；斜杠日期 2026/10/22 7:45 正确解析 |
| R11 | commit | pass | 日期平移副本导入 imported=11 skipped=0（999 行剔除后其余指标仍导）；id=imp_{code}_{epoch}、source=import、note 入库 |
| R11b | 导入记录口径 | pass | 11 条均 source=import |
| R12 | 幂等 | pass（含缺陷 D6） | 同 rows 重复 commit：原样 imported=0 skipped=11、平移副本 imported=0 skipped=11 —— 幂等成立；但"删除后重导同一文件"也 0 条，记 **D6** |
| R13 | export.zip preview | pass | format=apple_health、total=3、HK 类型 id 正确映射 weight/bodyfat/waist |
| R14 | huawei.json preview | pass | format=huawei_json、total=2、内嵌 JSON 解析 77.9/22.5，0.228→22.8% 小数口径 warning，心率 key 跳过 |
| R15 | 坏文件 | pass | 400"未识别到时间列…"，不 500 |
| R16 | 导入清理 | pass | imp_* 全部软删，records 回 8 |

### 模块2 阶段判定 — 7/7 pass

| # | 项目 | 结果 | 证据摘要 |
|---|---|---|---|
| S1 | stage-suggestion | pass | suggested=s1；items 3 阶段（s1 兜底 0 条规则，s2/s3 各 2 条），每条含 text/ok/detail |
| S2 | 阶段③腰围规则 | pass | text"腰围 ≤ 85 cm(最近14天最新值)" ok=false detail"当前 96 cm" |
| S3 | window=7/30 | pass | 均 200、suggested=s1 |
| S4 | 阶段页自动判定 UI | pass | ✓/✗ 逐条明细渲染（当前数据 ✓=0/✗=4 属数据状态预期）+ "✅ 建议"标 |
| S5 | 阶段/规则/模板渲染 | pass | 三阶段分区正常，"重新评估"按钮在位 |
| S6 | 手动切换 | pass | 选 s2→"已切换"toast→profile.current_stage_id=s2（同步后核对）→切回 s1 复原 |
| S7 | 切换历史 | pass | stage_history +2（manual, from/to/reason 齐全），UI"阶段切换历史"表可见；测后清理复原（基线 0 条） |

### 模块3 打卡 — 6/6 pass

| # | 项目 | 结果 | 证据摘要 |
|---|---|---|---|
| K1 | 习惯勾选/取消 | pass | 勾选"三餐规律·不乱加餐"→ habit_logs +1（done=1, date=当日, id={habit_id}_{date}）；取消→软删复原（可见回 2） |
| K2 | 习惯清单渲染 | pass | 饮食·控糖抗炎/睡眠·减压/运动 分组渲染，7天坚持率在位 |
| K3 | 有氧打卡 | pass | "打卡成功,坚持就是胜利"；workouts +1（type=cardio、items[快走 20min]、date 当日） |
| K4 | 力量打卡 | pass | type=strength、items[高位下拉 3×10×20kg] |
| K5 | 训练删除 | pass | 当日两条逐条"删"→ 服务端墓碑，可见回 1 |
| K6 | 本周进度 | pass | pills "有氧 本周 0/3→1/3→0/3"、"力量 本周 0/2→1/2→0/2" 随打卡/删除精确联动（按阶段 targets） |

### 模块4 AI 教练 — 15/16 pass（FAIL 项 = 缺陷 D5）

| # | 项目 | 结果 | 证据摘要 |
|---|---|---|---|
| C1 | 周报 SSE 流式 | pass | 524 条 delta 拼接 776 字、HTTP 200、14.3s、done 事件带 report_id |
| C2 | 周报存档 | pass | coach_reports 2→3，新档 keys=at/days/model/content 正文完整 |
| C3 | 周报坏入参 ×5 | pass | 无body/坏JSON/days:"abc"/days:true/days:0 → 各单条 error 事件（"请求体必须是JSON对象"×2、"days 必须是1-365的整数"×3），0 delta、3-19ms、零模型调用（D3 回归保持） |
| C4 | 问教练-库内 | pass | "平台期体重不动了怎么办…" → 回答引用"依据知识库·平台期：腰围减少=内脏脂肪在减…""依据知识库·保肌：蛋白质1.2-1.6g/kg…", done 带 qa_id、coach_qa +1 |
| C5 | 问教练-库外标注 | **FAIL → D5** | "光合作用的暗反应…"回答直接给内容、无"（以下为知识库之外的补充）"；复测：溏心蛋/量子纠缠正确标注，光合作用两次提问均缺失 → 间歇性，记 **D5（中低）** |
| C6 | 问教练坏入参 ×5 | pass | 各单条 error、毫秒级、零模型、不留档（与 iter4 口径一致） |
| C7 | 问答历史管理 | pass | 问答历史列表/展开/删（软删）；测试产生的 qa 删除后 coach_qa 可见回 1 |
| C8 | 历史解读管理 | pass | 预存 2 条渲染；新解读出现在列表；删除后回 2 |
| C9 | 教练页布局 | pass | 生成解读/问教练/问答历史/历史解读 四分区齐全 |

### 模块5 智能提示 — 5/5 pass

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| I1 | rate_alert | pass | null（当前 14 天体重点速率未超限） |
| I2 | plateau | pass | null（体重仍在降，非平台） |
| I3 | protein | pass | weight_kg=88.5、range=[1.2,1.6]、**target_g=124**、food_hint"≈ 鸡胸肉 564g"、note 引"依据知识库·蛋白质" |
| I4 | 今日页洞察卡 | pass | .protein-num=124、鸡胸肉 pill、note 渲染一致 |
| I5 | 规则口径 | pass | 基线无告警，文案依据知识库（protein.note 抽查） |

### 模块6 测量提醒 — 5/5 pass

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| M1 | /api/reminders | pass | weight due=true"今天还没有记录"（每天 1 次）；waist 按"每周 1 次"规则随日期推算：实测日距 10-25 ≥7 天 → due=true"距上次测量已 N 天"——与规则语义一致（清单原预期"不 due"系 10-26 基线，见执行注记 1） |
| M2 | 今日页横幅 | pass | 横幅集合与 API due 项 1:1 对应（当日 weight+waist 两条，文案/图标正确） |
| M3a/b | 横幅联动 | pass | UI 录入 77.77 →"该测体重了"消失；删除 → 复现 |
| M4 | 横幅通栏 | pass | 414/900/1280 三视口 banner x/宽 与容器内容区逐像素吻合（见矩阵 V5） |
| M5 | 设置页通知分区 | pass | 说明文案+按钮在位；headless 下 requestPermission=denied → toast"浏览器拦截了通知权限"+分区警告横幅、不写 wmNotify（按"被拦截"分支正确降级） |

### 模块7 数据安全 — 9/9 pass

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| A1 | 历史列表 | pass | seq/table/doc_id/action/device 齐全 |
| A2 | restore 空 delete 版本 | pass | 400"该历史为删除操作产生的空版本,不可恢复"（D1 回归保持） |
| A3 | restore 正常版本 | pass | ok:true，记录回到 77.78 版本；history 新增 device=restore 条目 |
| A4 | 快照列表 | pass | snapshot-2026-10-26.json / -25.json（name+size） |
| A5 | 快照下载 | pass | 200 JSON，docs 覆盖 10 表 |
| A6 | 导出 JSON | pass | version=1，docs 覆盖 metrics/stages/habits/exercises/profile/records/habit_logs/probe/workouts/coach_reports/coach_qa |
| A7 | 导出 CSV | pass | BOM+表头"指标,数值,单位,时间,来源,备注"；行数=可见记录数+表头 |
| A8 | 设置页入口 | pass | 数据安全分区（访问码/历史回滚/快照/导入 JSON）可见可展开；9 分区齐全 |
| A9 | 快照路径越权 | pass | `/api/snapshots/..%2Fmain.py` → 404，不泄露 |

### 模块8 PWA — 5/5 pass

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| P1 | manifest | pass | 200 application/manifest+json，name=体重管理 |
| P2 | sw.js | pass | 200 text/javascript |
| P3 | 图标 192/512 | pass | 均 200 image/png |
| P4 | 页面标题 | pass | document.title="体重管理" |
| P5 | 五页渲染 | pass | 今日/数据/阶段/训练/设置 h1 正常无白屏（教练页另测） |

---

## 二、适配矩阵结果（36/36 pass）

6 页面 × 6 视口，每格断言：V1 无横向溢出 / V2 底栏形态 / V3 双列(仅今日·教练) / V4 设置两列 / V5 横幅通栏 / V6 导入预览 6 列(窄屏注入) / V7 趋势图自适应 / V8 卡片完整 / V9 中文渲染。

| 页面＼视口 | 414×896 | 768×900 | 900×900 | 1024×900 | 1280×900 | 1920×1080 |
|---|---|---|---|---|---|---|
| 今日 #/ | pass | pass | pass | pass | pass | pass |
| 数据 #/data | pass | pass | pass | pass | pass | pass |
| 阶段 #/stage | pass | pass | pass | pass | pass | pass |
| 训练 #/training | pass | pass | pass | pass | pass | pass |
| 设置 #/settings | pass | pass | pass | pass | pass | pass |
| 教练 #/coach | pass | pass | pass | pass | pass | pass |

关键量测证据（DOM/computed style，详见 vf-matrix-results.json）：

**V2 底栏形态（今日页实测）**

| 视口 | 形态 | left/宽 | borderRadius | centerX | shadow |
|---|---|---|---|---|---|
| 414/768/900 | 通栏 | left=0，宽=视口宽 | 0px | 视口/2 | 无 |
| 1024/1280/1920 | 悬浮胶囊 | 宽 269.3px | 999px | 恰居中（512/640/960），bottom=视口-16px | 有 |

**V3 双列与列底差（balance.js 生效）**：今日页 1024/1280/1920 均为 flex 并排、两列底差 **96px ≤ 最高卡 566px**；教练页底差 **81.5px ≤ 最高卡 184.5px**；414/900 为 block 单列堆叠（colB.top ≥ colA.top，DOM 顺序恢复原始归属）。

**V4 设置页两列**：414 为 block 单列；1024 grid 两轨道 473px+473px（(960-14gap)/2，逐像素吻合）；1920 两轨道 501px+501px；「关于」分区通栏 aboutW=pageInnerW（960/1016）。

**V5 提醒横幅通栏**：414 banner(x16,w382)=容器内容区(x16,w382)；900(x86,w728)、1280(x132,w1016) 同样逐像素吻合。

**V6 导入预览表 6 列（窄屏真实注入 chinese.csv）**：414/768/900 thead 均恰 6 列；卡片未撑破（414 卡右缘 398 ≤ 414；768 卡宽 728 ≤ 768；900 卡宽 728 < 900），表容器 overflow-x 内滚（wrapScrollW=wrapClientW=容器宽，900 视口下表内容同宽不溢出），页面级 V1 仍无溢出。

**V7 趋势图初次渲染自适应**：各视口新挂载 canvas 宽=容器内容宽（414:354/354、1280:988/988，matrix 全过）。**但同页窗口尺寸变化后不重绘**（canvas 停留 354px 于 988px 容器）→ 缺陷 **D7**。

**V8 卡片完整/V9 中文渲染**：36 格全部无卡片超出视口、无卡内横向溢出（允许内滚的预览表容器除外）；各页 h1 中文渲染宽度正常、无豆腐块（截图佐证）。

---

## 三、缺陷（本轮新增，详见 qa/defects.md）

| 编号 | 严重度 | 摘要 | 复现要点 |
|---|---|---|---|
| **D5** | 中低 | "问教练"对库外问题未按规范标注"（以下为知识库之外的补充）"，间歇性（4 探针 2 缺失） | POST /api/coach/ask {"question":"光合作用的暗反应发生在细胞的哪个结构？"} → 回答直接以"…叶绿体基质…"开头无标注；对照"怎么煮出溏心蛋？""量子纠缠是什么？"均正确标注。任何视口（纯 API 行为） |
| **D6** | 低 | 导入记录删除后重导同一文件全部跳过（imported=0），数据无法靠重导恢复 | 先 commit chinese.csv→删除 imp_* 记录→再 commit 同文件 → {"imported":0,"skipped":11}；界面仅提示"导入 0 条,跳过 11 条"，与文案"可放心多次导入"相悖。任何视口 |
| **D7** | 低 | 趋势图不随窗口 resize 重绘（无 resize 监听），canvas 保持旧宽度 | #/data 趋势页在 414 初始化（canvas 354px）→ 视口改 1280（容器 988px）→ canvas 仍 354px；切子标签/换指标后自愈。桌面拖拽窗口/手机旋转可复现 |

QA 工具备注（非被测系统问题）：① cdp.mjs 的 DevTools WebSocket 会吊住 node 事件循环，复用脚本须显式 process.exit；② Vue 的 :disabled 按钮在输入后需等一个渲染 tick 再点击，否则点击无效（首轮 3 处 no-toast 均此因）；③ 离线优先应用在"初始同步完成前"的 UI 写入会被初始拉取竞态覆盖——UI 用例必须在 waitForAppReady（"在线"字样）之后执行；④ fullPage 截图中 fixed 底栏呈现在展开视口底部/中部为已知成像伪影，形态判定一律以 computed style 为准。

---

## 四、基线核对（测试后）— pass

| 表 | 测试后 | 基线 | 一致 |
|---|---|---|---|
| records 可见 | 8：weight 89.4/89.1/88.9/88.7/88.5、bodyfat 25.8/25.1、waist 96 | 8（同值） | ✓ |
| workouts 可见 | 1 | 1 | ✓ |
| habit_logs 可见 | 2 | 2 | ✓ |
| coach_qa 可见 | 1 | 1 | ✓ |
| coach_reports 可见 | 2 | 2 | ✓ |
| profile.current_stage_id | s1 | s1 | ✓ |
| stage_history 可见 | 0 | 0（任务起始态） | ✓ |
| metrics/habits | 6/10，未改动 | 6/10 | ✓ |
| AI 配置(/api/meta/ai) | glm-5.3-flash、demo=false，原样 | 原样 | ✓ |
| qa-vf-*/imp_* 可见残留 | 0 | 0 | ✓ |

history/snapshots 为追加式设计，本轮测试使其条目增加（含 qa 记录墓碑），属预期，不影响可见基线。QA 浏览器档案未写入 wmNotify（通知走"被拦截"分支）。

## 五、产物清单（qa/reports/）

- `feature-adapt-verify-report.md` — 本报告
- `vf-api-results.json` / `vf-ui-results.json` / `vf-matrix-results.json` — 三段断言逐项原始结果
- 代表视口整页截图（captureBeyondViewport，fixed 底栏有已知伪影，仅存档）：`vf-matrix-414x896-{今日,数据,阶段,训练,设置,教练}.png`、`vf-matrix-1280x900-{今日,数据,阶段,训练,设置,教练}.png` 共 12 张
- 过程存档：`vf-today-banners-1280.png`（双横幅+双列+胶囊同框）、`vf-import-preview-1280.png`（导入预览 6 列）
- 工具脚本：`qa/tools/vf-*.mjs`、`vf-scale.png`（模拟秤屏测试图）
