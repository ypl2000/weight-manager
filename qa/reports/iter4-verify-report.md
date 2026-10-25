# 迭代4(测量提醒 + 桌面通知 + 电脑端宽屏 + Tailscale 指南 + 开机自启)验证报告

- 被测：http://127.0.0.1:8000（FastAPI + Vue PWA 体重管理，pythonw 常驻实例，QA 全程未杀进程/未重启）
- 执行时间：2026-10-26 01:23–01:40（本地时间）
- 执行方式：服务端 API 断言（node fetch）+ Chrome headless CDP 驱动 UI + PowerShell COM/Get-CimInstance（复用并新增 `qa/tools/*iter4*` 脚本）
- 测试数据：体重 77.77 kg / 腰围 77.7 cm，qa-iter4-* 明显 id；真实腰围 96 记录在 API 规则测试中按"软删→按原 data 恢复"方式短暂离场（值与测量时间不变，已逐字节核对还原）；腰围指标 active 开关同样先存原档再还原。测后全部清理，基线已恢复（见第 16 项）。
- 本轮新配工具脚本（均为 qa/** 新增，未改动任何业务代码）：`qa/tools/iter4-reminders-api.mjs`、`iter4-ui.mjs`、`iter4-regression.mjs`、`iter4-notify-toast.mjs`、`iter4-startup-check.ps1`。

## 结果总览

| # | 项目 | 结果 |
|---|---|---|
| 1 | /api/reminders 基线（真实数据：体重 due / 腰围不 due） | pass |
| 2 | /api/reminders 规则 ×8（今日已录/最新记录选择/≥7天/从未记录/停用指标/复原） | pass |
| 3 | 今日页提醒横幅：显示"该测体重了"、无腰围条、录后消失、删后复现 | pass |
| 4 | 桌面通知：设置分区 + 开关 + requestPermission（headless 如实记录） | pass |
| 5 | 桌面通知：App.vue 30 分钟轮询（代码核对 + 运行时挂载执行 + 每日去重） | pass |
| 6 | 宽屏 ≥1024px：.page 1080px / Today 双列 / 底栏悬浮胶囊居中（1280 实测） | pass |
| 7 | 768–1023px 保持旧单列（900 实测 + 1023/1024 边界） | pass |
| 8 | 414px 手机布局（旧单列 + 通栏底栏） | pass |
| 9 | 设置页两列网格（「关于」通栏） | pass |
| 10 | Tailscale 指南文档完整 | pass |
| 11 | 开机自启：Startup 快捷方式 + pythonw 常驻 + 8000 可用 | pass |
| 12 | 回归：记录增删（UI 77.77 全口径 a1/a2/b1/b3） | pass |
| 13 | 回归：stage-suggestion | pass |
| 14 | 回归：PWA 资源 | pass |
| 15 | 回归：coach ask 坏入参 error 事件 ×5 | pass |
| 16 | 基线核对 | pass |
| | **合计** | **16 pass / 0 fail，无新增缺陷（O4 观察项入台账，不计功能缺陷）** |

---

## 1–2) 测量提醒 API GET /api/reminders — pass ×9

完整断言序列见 `qa/reports/iter4-reminders-api.json`（基线 + 逐步 expect/got + 终态核对）。

### 1) 真实数据基线 — pass
`weight: due=true, reason="今天还没有记录", rule="每天 1 次"`；`waist: due=false, reason="1 天前测过（10-25）", rule="每周 1 次"`。与任务给定真实数据预期完全一致（体重今日未录 → due；腰围昨天 96 → 不 due）。items 顺序 [weight, waist]，带 generated_at。

### 2) 规则造数验证（S1–S8，每步服务端立即断言）— pass ×8
| 步骤 | 操作 | 断言 | 结果 |
|---|---|---|---|
| S1 | 录入今日体重 77.77（qa-iter4-weight） | weight → due=false "今天已记录" | pass |
| S2 | 再加 10 天前腰围 77.7（真实 96 仍在） | waist → 仍 not due "1 天前测过（10-25）"（证明取**最近**一条，非最早） | pass |
| S3 | 软删真实腰围 96 | waist → due=true "距上次测量已 10 天"（≥7 天分支） | pass |
| S4 | 删测试腰围 | waist → due=true "还没有记录过"（从未记录分支） | pass |
| S5 | 按**原 data** 恢复真实腰围 96 | waist → due=false "1 天前测过（10-25）"；恢复后 data 与原档逐字段一致 | pass |
| S6 | 删测试体重 | weight → due=true "今天还没有记录" | pass |
| S7 | 腰围指标 active=false（原档先存） | items 只剩 [weight]，weight 规则不受影响（停用指标不出现） | pass |
| S8 | 恢复指标 active=true（原 data） | items 回 [weight, waist] | pass |

终态核对：records 可见 8 条原值、metrics 腰围 data 与原档一致、无 qa-* 可见残留。测试后 history 审计条目增加属追加式设计预期。

## 3) 今日页提醒横幅 — pass

- **显示**：`#/` 页面顶部（阶段卡之上）出现且仅出现 1 条横幅：**"⚖️ 该测体重了 · 今天还没有记录（每天 1 次）"**（`.page > .banner.warn`，6ms 内就绪）；**无** "该测腰围了" 条（腰围不 due，与 API 一致）。截图 `iter4-desktop-1280.png`（1280 宽，双列布局同框）。
- **消失**：经 `#/data` UI 录入 77.77（toast"已保存"）→ 回 `#/` 横幅消失（banners=[]）。
- **复现**：UI 删除 77.77（toast"已删除"）→ 回 `#/` 横幅重新出现（"该测体重了"）。
- 900px 与 414px 视口下横幅同样正确显示（`iter4-tablet-900.png` / `iter4-mobile-414.png` 可见）。

## 4) 桌面通知：设置分区与开关 — pass（headless 权限行为如实记录）

- **分区存在**：`#/settings` "测量提醒(桌面通知)" 分区，说明文案含"今日页顶部会显示提醒横幅…每 30 分钟检查一次…同一指标每天只弹一次""通知仅在应用打开时弹出(本地 PWA 无推送服务…)"，按钮初始 "开启桌面通知"。截图 `iter4-settings-notify.png`。
- **headless 默认拒绝（如实记录）**：headless Chrome 无通知提示 UI，`Notification.requestPermission()` 直接落 `denied`。页面行为**正确**：toast "浏览器拦截了通知权限"（#toast 实测捕获）、分区显示警告横幅"浏览器拦截了通知权限:请在地址栏附近的站点设置里把'通知'改为允许…"、**不**写 `wmNotify`、按钮文案不变。
- **授权后（CDP Browser.grantNotifications 同会话授予）**：再点"开启桌面通知" → toast "桌面通知已开启"、`wmNotify=1`、按钮变 "已开启桌面通知(点击关闭)"、警告横幅消失。再点可关闭：toast "桌面通知已关闭"、`wmNotify` 移除、按钮复原（浏览器授权不撤回，与设计说明一致）。
- 结论：开关与授权分支逻辑在真实浏览器（有提示 UI）下预期可用；headless 的自动拒绝是环境行为，页面按"被拦截"分支正确降级，非缺陷。

## 5) 桌面通知：App.vue 30 分钟轮询 — pass（代码层面 + 运行时证据）

- **代码核对**（frontend/src/App.vue）：`REMIND_MS = 30*60*1000`，`onMounted` 即调 `checkReminders()` 并 `setInterval` 每 30 分钟一次，`onUnmounted` 清定时器；`checkReminders` 前置守卫：`wmNotify!=='1'` 不发、`Notification.permission!=='granted'` 不发、同一指标以 `wmNotified_<code>=当日日期` 每天只弹一次、离线/失败静默。
- **运行时证据**：`wmNotify=1` + 权限 granted 下重载页面 → 挂载即执行（`wmNotified_weight=2026-10-26` 被写入，当日体重确为 due，即真实会弹"体重管理：今天还没有记录"通知）；再次重载键值保持同日不变（去重生效）。测后已清理 QA 档案里的 `wmNotify`/`wmNotified_weight`。

## 6–9) 电脑端宽屏与响应式 — pass ×4

实测 computed style（Chromium CDP，非肉眼）：

| 视口 | .page max-width | .cols | 底栏 .tabbar | 判定 |
|---|---|---|---|---|
| 1280×900 | **1080px**，居中(centerX=640) | **grid 两列** 501px+501px，左右卡并排(sideBySide=true) | **悬浮胶囊**：borderRadius 999px、居中(centerX=640)、带阴影、宽 269px、bottom 16px | 新宽屏布局 ✓ |
| 1023×900 | 760px | block（单列） | 通栏、无圆角、无位移 | 旧布局 ✓ |
| 1024×900 | 1080px | grid 两列 | 胶囊 | 边界恰在 1024 生效 ✓ |
| 900×1000 | 760px | block，两列容器上下堆叠(stacked=true) | 通栏(left:0,width:900)、borderRadius 0、transform none | **旧单列保持** ✓ |
| 414×896 | 760px(实际满宽 414) | block，堆叠 | 通栏(width:414) | 手机布局不变 ✓ |

- 设置页 1280px：`.settings-page` grid 两列（501px+501px），9 个分区两列排布，「关于」分区 `grid-column: 1/-1` 通栏（截图同框可见）。
- 截图目视复核：`iter4-desktop-1280.png`（横幅+双列+胶囊底栏）、`iter4-tablet-900.png`（单列+通栏底栏）、`iter4-mobile-414.png`（手机单列）、`iter4-settings-notify.png`（两列+通知分区展开）均符合预期。
- 备注：全页截图中固定定位的底栏呈现在视口底部对应位置（截图工具 captureBeyondViewport 对 fixed 元素的已知成像方式），非布局问题——computed style 证实 desktop `bottom:16px` 居中胶囊、mobile `bottom:0` 通栏。

## 10) Tailscale 指南 — pass

`docs/tailscale-guide.md` 存在（46 行）：原理说明 + 电脑端（winget 安装/登录/`tailscale ip -4` 取 IP/确认 8000 服务）+ 手机端（同账号）+ 使用（100.x.x.x:8000、重加主屏）+ 安全与防火墙（访问码建议 + `New-NetFirewallRule` 放行 8000 命令）+ 常见问题 4 条（国内登录/速度/免费档限制/撤销）+ 与本应用离线优先设计的关系。步骤完整可照做，符合"只查文档"要求。

## 11) 开机自启 — pass

- **Startup 快捷方式**：`C:\Users\11645\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\体重管理.lnk` 存在；PowerShell WScript.Shell COM 读取：`TargetPath=C:\Users\11645\Desktop\体重管理\scripts\autostart.bat`（与预期一致，文件存在）、`WorkingDirectory=项目根`、`WindowStyle=7`（隐藏/最小化）、`TargetIsAutostartBat=True`。
- **autostart.bat 载荷**：`cd 项目根` → `start /b backend\.venv\Scripts\pythonw.exe -m uvicorn main:app --host 0.0.0.0 --port 8000`，与在跑实例命令行一致。
- **pythonw 常驻**：`pythonw.exe` PID **16448** 持有 0.0.0.0:8000 LISTEN，命令行为本项目 `backend\.venv\Scripts\pythonw.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir ...backend`；`/manifest.webmanifest` 探活 200。QA 全程未杀/未重启。
- 观察项（不计缺陷）：机器上另有 1 个同配置 pythonw（PID 13204，未持有端口），见缺陷台账 O4。

## 12–15) 回归冒烟 — pass ×4

- **记录增删（UI 全口径）**：`#/data` 录入体重 77.77 → toast"已保存" + 列表行"体重 77.77 kg"；**b1 服务端 978ms（≤3s）** 可见（id f9a8ced8-…）；UI 删除 toast"已删除" → GET 列表消失，cursor=0 拉取确认墓碑 `deleted=true`。
- **stage-suggestion**：`suggested="s1"`、3 个阶段带规则明细；阶段③腰围规则 `ok=false, detail="当前 96 cm"`（未命中，符合基线）。
- **PWA 资源**：`/manifest.webmanifest` 200 (application/manifest+json)、`/sw.js` 200 (text/javascript)、`/icons/icon-192.png` 200 (image/png)；今日/数据/设置页均正常渲染无白屏。
- **coach ask 坏入参 ×5**（D3 口径）：无 body / 坏 JSON `not-json{{` / `question:123` / 空白串 / 501 字 → 均单条 SSE **error 事件**（"请求体必须是JSON对象"×2、"question 必须是字符串"、"question 不能为空"、"question 长度不能超过500字"），HTTP 200、0 delta/0 done、4–16ms 秒回、零模型调用；事后 coach_qa 可见仍 1 条（不留档）。

## 16) 基线核对 — pass

| 表 | 测试后 | 基线 | 一致 |
|---|---|---|---|
| records 可见 | 8：weight 89.4/89.1/88.9/88.7/88.5、bodyfat 25.8/25.1、waist 96 | 8（同值） | ✓ |
| workouts 可见 | 1 | 1 | ✓ |
| habit_logs 可见 | 2 | 2 | ✓ |
| coach_qa 可见 | 1（a0170c32-…，预存在） | 1 | ✓ |
| coach_reports 可见 | 2（预存在） | 2 | ✓ |
| profile | current_stage_id=s1 | s1 | ✓ |
| metrics（腰围） | active=true，data 与原档逐字段一致 | active=true | ✓ |

全表扫描无 qa-* 可见残留；77.77/77.7 测试记录均为墓碑；history 审计条目增加属追加式设计预期。QA 浏览器档案中 `wmNotify`/`wmNotified_weight` 已清理。

## 缺陷

**无新增功能缺陷。** 观察项 1 条入台账（O4，信息级）：autostart.bat 无防重入检查，当前机器存在 2 个同配置 pythonw 实例（13204 未持有端口、16448 正常服务 8000），服务不受影响；建议后续在 autostart.bat 加端口占用检测。见 `qa/defects.md`。

QA 工具备注（非被测系统问题）：① 本轮一个 QA 辅助 ps1 曾因 PowerShell 5.1 对无 BOM UTF-8 按 GBK 解析产生中文路径误判（.lnk 误报不存在），已改为编码无关枚举法复核，结论以复核为准；② 通知开关 toast 首测未捕获系 QA 选择器写成 class（实际为 `#toast`），补测已捕获全部文案；③ headless 下 CDP 授权为会话作用域，跨脚本需在会话内重新授予。

## 截图与产物清单（qa/reports/）

- `iter4-desktop-1280.png` — 1280px 今日页：提醒横幅"该测体重了" + 双列布局 + 悬浮胶囊底栏
- `iter4-tablet-900.png` — 900px 今日页：旧单列布局 + 通栏底栏（横幅正常）
- `iter4-mobile-414.png` — 414px 今日页：手机单列布局（横幅正常）
- `iter4-settings-notify.png` — 1280px 设置页：两列网格 + "测量提醒(桌面通知)"分区展开
- `iter4-reminders-api.json` — /api/reminders 规则验证完整序列（基线 + S1–S8 expect/got + 终态）
- 另：`iter4-desktop-widescreen.png` 为开发侧随迭代 4 提交入库的截图（qa/reports 内原样保留，未改动）
