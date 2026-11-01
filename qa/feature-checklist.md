# 功能检测清单（全量已交付功能 v1 → 迭代4）

- 被测：http://127.0.0.1:8000（FastAPI + Vue3 PWA 体重管理，pythonw 常驻实例，**严禁杀进程/重启**）
- 执行方式：服务端 API 断言 + Chrome headless CDP 页面断言（DOM/computed style 为准，截图仅存档）
- 测试数据约定：明显值（体重 77.77、腰围 77.7 等），id 用 `qa-vf-*` / `imp_*`（导入确定性 id），测后全部软删除清理
- **基线（测试后必须复原）**：records 可见 8 条（weight 89.4/89.1/88.9/88.7/88.5、bodyfat 25.8/25.1、waist 96）、workouts 1、habit_logs 2、coach_qa 1、coach_reports 2、profile.current_stage_id=s1。history/snapshots 为追加式设计，条目增加属预期。

---

## 模块1 记录（手动 CRUD / 拍照识别 / 批量导入）

| # | 项目 | 步骤 | 通过标准 |
|---|---|---|---|
| R1 | 手动录入（API 口径） | PUT /api/tables/records/qa-vf-* 写入 weight 77.77 | ok:true；GET 列表可见，字段 metric_code/value/unit/at 完整 |
| R2 | 手动录入（UI 口径） | #/data 录入体重 77.77 → 保存 | toast"已保存"；最近记录列表出现新行；≤3s 服务端可见（快速同步） |
| R3 | 手动编辑 | 对 R1 记录 PUT 同 id 改值 77.78 | 列表值变为 77.78，updated_at 变新 |
| R4 | 手动删除（软删） | DELETE 该记录 | GET 列表消失；/api/sync cursor=0 拉取可见墓碑 deleted=true、data={} |
| R5 | LWW 新者胜 | 以更旧 updated_at 推送同 id 旧版本（/api/sync changes） | 服务端保留较新值，不被旧版本回滚 |
| R6 | 拍照识别配置 | GET /api/meta/ai | api_key 非空、demo=false、model=glm-5.3-flash（真实模型）；设置页 AI识别 分区可展开含 base_url/模型/Key 字段 |
| R7 | 拍照识别-真实识别 | 生成含"77.77"文本的测试图 → POST /api/recognize | demo=false；candidates 数组、元素含 metric_hint/value/unit/confidence/metric_code 模糊匹配 |
| R8 | 拍照识别-空图 | POST 空文件 | 400"图片为空" |
| R9 | 拍照识别-UI 流程 | #/data 📷 识别 → 选图 → 识别 → 候选确认入库 → 删除测试记录 | 候选区渲染；确认后 records 出现对应记录；清理后基线不变 |
| R10 | 导入-chinese.csv preview | POST /api/import/preview (chinese.csv) | 识别为 generic_csv；5 行；映射 时间→at、体重/kg→weight、体脂率/%→bodyfat、腰围/cm→waist；坏行有 warnings |
| R11 | 导入-chinese.csv commit | POST /api/import/commit (preview rows) | imported=9（3 有效行 × 3 指标）、skipped=4（999 超范围 + 坏日期行）；口径换算：0.249→24.9%；id=imp_{code}_{epoch}、source=import |
| R12 | 导入幂等 | 同一 rows 再次 commit | imported=0、skipped=13；可见记录数不变 |
| R13 | 导入-export.zip preview | POST preview (export.zip) | 识别为 apple_health；解析 export.xml 4 条 Record 无 500 |
| R14 | 导入-huawei.json preview | POST preview (huawei.json) | 识别为 huawei_json；samplePoints 内嵌 JSON 解析出 weight/bodyfat；心率等非体测 key 跳过 |
| R15 | 导入-坏文件 | POST preview (随机 txt) | 400"解析失败/不识别的文件类型"，不 500 |
| R16 | 导入清理 | 删除全部 imp_* 记录 | records 可见回到 8 条基线 |

## 模块2 阶段判定

| # | 项目 | 步骤 | 通过标准 |
|---|---|---|---|
| S1 | stage-suggestion API | GET /api/stage-suggestion | suggested="s1"；3 个阶段各带规则数组，每条含 text/ok/detail |
| S2 | 规则明细正确性 | 检查阶段③腰围规则 | ok=false，detail 含"当前 96 cm"（基线数据未命中） |
| S3 | window 参数 | GET /api/stage-suggestion?window=7 与 30 | 均 200 且结构一致 |
| S4 | 阶段页自动判定 UI | #/stage "自动判定"分区 | 展示建议阶段 + ✓/✗ 规则明细逐条可查 |
| S5 | 阶段页规则/模板可查 | #/stage 分区渲染 | 三阶段名称/目标/清单正常渲染，无空白 |
| S6 | 手动切换 | #/stage 手动切换到 s2 → 切回 s1 | toast"已切换"；profile.current_stage_id 变更；stage_history 新增记录（mode=manual）；切回后 profile=s1 |
| S7 | 切换历史展示 | #/stage "阶段切换历史" | 显示切换记录（时间/目标/原因），非"还没有切换记录" |

## 模块3 每日打卡与训练

| # | 项目 | 步骤 | 通过标准 |
|---|---|---|---|
| K1 | 习惯勾选 | #/ 今日页勾选一个未勾选习惯 | habit_logs 可见 +1（当日 done=1）；再取消勾选 → 该记录软删除，可见数回到 2 |
| K2 | 习惯清单渲染 | #/ 习惯卡片 | 清单来自 habits 表正常渲染，勾选状态与 habit_logs 一致 |
| K3 | 训练打卡-有氧 | #/training 保存有氧（cardio）测试训练 | workouts +1，字段 type/date/items 完整；本周有氧 pill 计数 +1 |
| K4 | 训练打卡-力量 | 保存力量（strength）测试训练 | workouts +1，type=strength；本周力量 pill 计数 +1 |
| K5 | 训练列表与删除 | 列表出现两条测试记录 → 逐条删除 | 服务端墓碑；可见回到 1 条基线 |
| K6 | 本周进度 | #/training 顶部 pills | "有氧 本周 x/y 次""力量 本周 x/y 次"按当前阶段 targets 计算 |

## 模块4 AI 教练（周报 / 问教练 / 历史管理）

| # | 项目 | 步骤 | 通过标准 |
|---|---|---|---|
| C1 | 周报 SSE 流式 | POST /api/coach/report {}（SSE） | 多条 delta 事件递增拼接成文；末尾 done 事件带 report_id；HTTP 200 |
| C2 | 周报存档 | 完成后 GET coach_reports | 可见 +1（2→3），新档含 markdown 正文与模型名 |
| C3 | 周报坏入参（D3 回归） | 无 body / 坏 JSON / days:"abc" / days:true | 单条 SSE error 事件（"请求体必须是JSON对象"/"days 必须是1-365的整数"），HTTP 200、零 delta、毫秒级、零模型调用 |
| C4 | 问教练-库内问题 | POST /api/coach/ask {"question":"减重速率超过多少算不安全？"} | 流式回答；内容引用知识库并注明出处（"依据知识库·…"字样）；done 带 qa_id；coach_qa +1 |
| C5 | 问教练-库外问题 | question="光合作用发生在细胞的哪个结构？" | 回答开头标注"（以下为知识库之外的补充）" |
| C6 | 问教练坏入参 | 无 body / 坏 JSON / question:123 / 空白串 / 501 字 | 各单条 SSE error、HTTP 200、零模型调用、不留档 |
| C7 | 问答历史管理 | #/coach 问答历史分区：列表/展开/删 | 历史条目渲染、可展开看回答；删除 → 软删墓碑；测试产生的 qa 记录删除后 coach_qa 可见回到 1 |
| C8 | 历史解读管理 | #/coach 历史解读分区 | 预存 2 条渲染；C2 生成的新解读出现在列表；删除后回到 2 |
| C9 | 教练页布局 | #/coach | 生成解读/问教练/问答历史/历史解读分区齐全 |

## 模块5 智能提示（/api/insights 三规则）

| # | 项目 | 步骤 | 通过标准 |
|---|---|---|---|
| I1 | rate_alert 基线 | GET /api/insights | rate_alert=null（当前 14 天内体重点 <4 或速率正常） |
| I2 | plateau 基线 | 同上 | plateau=null（体重仍在明显下降，非平台） |
| I3 | protein 目标 | 同上 | protein 目标 =124g（88.5kg × (1.2+1.6)/2），区间 1.2-1.6g/kg、鸡胸肉换算存在 |
| I4 | 今日页洞察卡 | #/ 智能提示卡 | 三条洞察渲染，数值与 API 一致（124g 等） |
| I5 | 规则口径抽查 | 确认 message 文案 | 引用知识库出处（依据知识库·…），可解释 |

## 模块6 测量提醒

| # | 项目 | 步骤 | 通过标准 |
|---|---|---|---|
| M1 | /api/reminders 基线 | GET /api/reminders | weight: due=true "今天还没有记录"（每天 1 次）；waist: due=false "1 天前测过（10-25）"（每周 1 次）；items 顺序 [weight, waist] |
| M2 | 今日页横幅 | #/ 顶部 | 恰 1 条"该测体重了"横幅（.banner.warn），通栏、无腰围条 |
| M3 | 横幅联动 | UI 录入 77.77 → 回 #/；再删除 | 录入后横幅消失；删除后复现 |
| M4 | 横幅通栏 | 量 .banner 宽度/位置 | 左右贴齐 .page 容器（无侧边距） |
| M5 | 设置页通知分区 | #/settings "测量提醒(桌面通知)" | 说明文案 + "开启桌面通知"按钮；headless 下 requestPermission=denied 走"被拦截"分支正确降级（toast/警告横幅、不写 wmNotify） |

## 模块7 数据安全（历史回滚 / 快照 / 导出）

| # | 项目 | 步骤 | 通过标准 |
|---|---|---|---|
| A1 | 历史列表 | GET /api/history | 有审计记录，含 table/doc_id/action/device/seq |
| A2 | restore 空 delete 版本（D1 回归） | 对软删除产生的空版本 POST /api/history/{seq}/restore | 400"该历史为删除操作产生的空版本,不可恢复"，不产生可见空记录 |
| A3 | restore 正常版本 | 对测试记录的非空版本 restore | ok:true；记录回到历史版本；history 新增 device=restore 条目 |
| A4 | 快照列表 | GET /api/snapshots | ≥2 个（snapshot-2026-10-25/26.json），含 name/size |
| A5 | 快照下载 | GET /api/snapshots/{name} | 200 application/json，docs 结构完整 |
| A6 | 导出 JSON | GET /api/export/all | 200；version+docs，覆盖全部表 |
| A7 | 导出 CSV | GET /api/export/records.csv | 200 text/csv；表头 指标/数值/单位/时间/来源/备注；行数=可见记录数 |
| A8 | 设置页入口 | #/settings 数据安全分区 | 访问码/历史回滚/快照入口可见可展开 |
| A9 | 越权保护抽查 | GET /api/snapshots/..%2fmain.py 类路径 | 400/404，不泄露文件 |

## 模块8 PWA

| # | 项目 | 步骤 | 通过标准 |
|---|---|---|---|
| P1 | manifest | GET /manifest.webmanifest | 200 application/manifest+json，name=体重管理 |
| P2 | sw.js | GET /sw.js | 200 text/javascript |
| P3 | 图标 | GET /icons/icon-192.png、icon-512.png | 均 200 image/png |
| P4 | 页面标题 | document.title 与 index.html | "体重管理" |
| P5 | 五页无白屏 | 依次打开 5+1 页 | 每页 page-head h1 正常渲染 |

## 模块9 双端页面适配矩阵（重点，DOM 断言为准）

页面 × 视口：今日(#/) / 数据(#/data) / 阶段(#/stage) / 训练(#/training) / 设置(#/settings) / 教练(#/coach) ×
414×896、768×900、900×900、1024×900（断点边界）、1280×900、1920×1080，共 36 格。

每格断言（全部以 getBoundingClientRect / computed style 量取，不用目测截图）：

| # | 断言 | 通过标准 |
|---|---|---|
| V1 | 无横向溢出 | document.documentElement.scrollWidth ≤ clientWidth（允差 1px） |
| V2 | 底栏形态 | <1024：.tabbar 通栏（left=0、宽=视口宽、borderRadius 0、bottom=0）；≥1024：悬浮居中胶囊（borderRadius 999px、水平居中、bottom 16px、带阴影） |
| V3 | Today/Coach 双列 | ≥1024：.cols 为 flex 两列并排（colB.x ≥ colA 右缘）；**两列底差 ≤ 列内最高卡高**（balance.js 贪心保证）；<1024：单列堆叠（colB.y ≥ colA 底缘） |
| V4 | 设置页两列 | 仅 ≥1024：.settings-page display=grid 两列，「关于」分区通栏；<1024 单列 |
| V5 | 提醒横幅通栏（今日页） | .banner 宽度=容器内容宽，无左右空隙 |
| V6 | 导入预览表 6 列（设置页，窄屏加测） | 414/768/900 注入真实 preview 后：卡片不被撑破（容器 scrollWidth 允许内部横向滚动，页面级 V1 仍成立） |
| V7 | 趋势图自适应（数据页） | canvas 宽度随视口变化 = 容器内容宽（两次视口宽度不同则 canvas 宽度跟随变化） |
| V8 | 卡片完整 | 各 .card rect 在容器内、无被视口切断；卡片内无横向溢出（table 容器允许内部滚动除外） |
| V9 | 中文渲染 | 中文文本节点渲染宽度 >0、字体族生效；截图存档佐证无豆腐块 |

截图规约：fullPage 截图会把 fixed 底栏画在展开视口底部造成伪影——适配判定一律以 DOM/computed style 为准，截图仅存档参考。

## 收尾核对

| # | 项目 | 通过标准 |
|---|---|---|
| Z1 | 基线复原 | records 可见 8（原值）、workouts 1、habit_logs 2、coach_qa 1、coach_reports 2、profile=s1、metrics 与 habits 原样；无 qa-vf-*/imp_* 可见残留 |

---

## 执行注记（2026-11-01/02 实测轮）

1. **M1/M2 期望随日期滚动**：清单原按 2026-10-26 基线写"waist 不 due"。实测日为 11-01/02（服务器 UTC+8），腰围最近记录 2026-10-25 距今 ≥7 天，按"每周 1 次"规则**正确地**变为 due=true（"距上次测量已 N 天"）。本轮断言按规则语义随当天日期动态推算，规则行为本身通过。
2. **S4 阶段规则 ✓/✗ 基线**：当前真实数据下 s2/s3 的 4 条规则全部未命中（✓=0/✗=4），s1 作为无条件兜底为建议阶段——与 API 一致，属数据状态而非缺陷。
3. **R11 commit 数量口径**：chinese.csv 第 4 行体重 999 在 preview 即剔除，但该行其余有效指标（体脂率/腰围）仍正常导入，故有效行合计 3×3+2=11 条；坏日期行整行丢弃。
4. **R12 幂等口径**：确定性 id `imp_{code}_{epoch}` 对**墓碑同样占位**（首写优先设计），删除导入记录后重导同一文件 imported=0——已记为缺陷 D6。commit 用 -365 天平移副本验证全新 id 路径。
