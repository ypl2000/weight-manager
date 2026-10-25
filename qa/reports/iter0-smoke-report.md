# v1 冒烟测试报告（iter0，断点续跑完成）

- 被测：http://127.0.0.1:8000（FastAPI + Vue PWA 体重管理）
- 执行轮次：2026-10-25 22:08–22:50（本地时间）；上一轮完成 a1–a3 主体，本轮从 a3 收尾起续跑 b–g、z
- 执行方式：Chrome headless(1280×900) + DevTools 协议驱动 UI（`Runtime.evaluate` 内 `el.click()`，规避后台节流导致的选择器点击超时）+ 服务端 API 断言，**以服务端 API 终态为最终判定**。子代理环境无浏览器插件权限，故自建 CDP 驱动，工具见 `qa/tools/`（cdp.mjs + 各 step-*.mjs，均为本轮 QA 新增，未改动任何业务代码）
- 测试数据：体重 77.77 kg、训练"测试-压腿 7 分钟"等明显值，结束后全部清理（见 z1/z2）

## 结果总览

| 链路 | 项 | 结果 |
|---|---|---|
| a 记录 | a1 a2 a3 | 3/3 pass |
| b 同步 | b1 b2 b3 | 3/3 pass |
| c 阶段 | c1 c2 c3 | 3/3 pass |
| d 回滚 | d1 d2 d3 d4 | 4/4 pass |
| e 打卡 | e1 e2 | 2/2 pass |
| f PWA | f1 f2 f3 f4 | 4/4 pass |
| g 设置 | g1 g2 g3 | 3/3 pass |
| z 收尾 | z1 z2 | 2/2 pass |
| **合计** | | **24/24 pass，0 fail** |

缺陷候选 1 项（恢复"删除"历史版本产生空记录，中低危，详见文末），观察项 3 项。

---

## a) 记录链路 — pass ×3

- **a1 pass**（上轮 22:15 执行；本轮 22:34 经 b1 同路径复验）：`#/data` 选"体重"、输入 77.77、点击"保存记录"，toast"已保存"出现（step-b1 `toast:true`）。
- **a2 pass**（本轮 22:38 复验）：`最近记录`列表首行出现新行 `体重 77.77（10/25 22:34）`（step-b2b3 `rowsBefore` DOM 文本）。
- **a3 pass**：切到"趋势"子标签，echarts 画布渲染，体重曲线在 25 日末端出现 77.77 数据点。截图 `qa/reports/iter0-a-trend-7777.png`（上轮 22:15 摄取，本轮核验有效）。

## b) 同步链路 — pass ×3

- **b1 pass**（22:34:47）：UI 保存 77.77 后轮询服务端，**605 ms** 内 `GET /api/tables/records` 可见（≤3000ms 达标；机制为 queueWrite 后 1.5s 快速推送，实测更快）。证据：step-b1 输出 `elapsedMs:605`，新记录 id `3870f5b1-db8e-4327-a3f7-5e0ca82968b1`（下称 R2）。
- **b2 pass**（22:38）：以**更旧 1 小时**的 `updated_at`（13:34:47Z）+ 改值 55.55 对同 id R2 `POST /api/sync`。结果：服务端保持 77.77、`updated_at` 不变（14:34:47.476Z）→ 后写者胜，**未回滚**；且被拒推送未产生 history 条目（前后均 1 条）。证据：step-b2b3 `B2_LWW notRolledBack:true, rejectedNoHistory:true`。
- **b3 pass**（22:38–22:39）：UI 列表点"删"（toast"已删除"）→ `GET /api/tables/records` 不再返回 R2（实测 <1s）；`POST /api/sync cursor=0` 全量拉取可见墓碑 `R2 deleted:true (updated_at 14:38:47.265Z)`。

## c) 阶段判定链路 — pass ×3

- **c1 pass**（22:13）：`GET /api/stage-suggestion` 返回 `suggested:"s1"`，与基线快照 `baseline-stage-suggestion.json` **逐字节一致**；阶段②/③每条规则均含 `text/ok/detail`。
- **c2 pass**（同上）：阶段③规则 `"腰围 ≤ 85 cm(最近14天最新值)"` → `ok:false, detail:"当前 96 cm"`。
- **c3 pass**（22:43）：`#/stage` "自动判定"分区展示 阶段① ✅建议、阶段②/③ ✗ 规则与明细（1个数据点 / 实际约 0.5 次/周 / 当前 96 cm）。截图 `qa/reports/iter0-c-stage-auto.png`。

## d) 历史回滚链路 — pass ×4

- **d1 pass**（22:41）：`GET /api/history` 共 51+ 条（基线 50 + 本轮新增，追加式符合预期），条目含 `table/doc_id/action/device`（样例 seq51–53：R2 的 create/delete，device=浏览器设备 UUID）。
- **d2 pass**：取 R2 创建版本 seq=52 `POST /api/history/52/restore` → `200 {"ok":true}`。
- **d3 pass**：恢复后 `GET /api/tables/records` 中 R2 重新可见（value 77.77）；history 顶部新增 seq=54 `device:"restore", action:"update"`。
- **d4 pass**（22:42–22:47）：UI 删除恢复出的 R2（1.6s 内服务端转墓碑）；同路径清掉上轮遗留的 R1（`f55e1170…`，22:15 创建的 77.77）。最终 visible records 回到 **8 条基线**。

## e) 习惯/训练打卡链路 — pass ×2

- **e1 pass**（22:44）：今日页勾选"蔬菜量 ≥ 主食+肉"→ 1.6s 内 `GET /api/tables/habit_logs` 新增 `h_d2_2026-10-25 {date, habit_id:h_d2, done:1}`；取消勾选 → 该记录转墓碑（cursor=0 拉取确认 `deleted:true`），可见 habit_logs 回到基线 2 条（h_d1、h_s1 done=1）。
- **e2 pass**（22:44）：`#/training` 经动作库添加"测试-压腿(有氧)"→ 表单选该项目、时长 7 分钟 → "保存打卡"（toast"打卡成功"）→ 0.5s 内 `GET /api/tables/workouts` +1，字段完整：`{date:2026-10-25, type:cardio, items:[{name:测试-压腿, minutes:7, hr:null}], duration_min:7, feel:""}`；UI 删除后可见回 1（快走 35 分钟）、墓碑确认；动作库"测试-压腿"亦删除（墓碑），可见 exercises 回 11。

## f) PWA 资源 — pass ×4

- **f1 pass**：`/manifest.webmanifest` → 200 `application/manifest+json`（491B）
- **f2 pass**：`/sw.js` → 200 `text/javascript`（1122B）
- **f3 pass**：`/icons/icon-192.png` → 200 `image/png`（1679B）
- **f4 pass**（22:45）：首页 h1"今日"、日期、已同步、当前阶段卡、快捷记录、今日打卡全部渲染，无白屏。截图 `qa/reports/iter0-f-home-today.png`。

## g) 设置页分区 — pass ×3

- **g1 pass**："AI 识别(拍照提取数据)"可展开，含 接口地址(base_url)/模型名/API Key/演示模式 字段。截图 `iter0-g-settings-all-open.png`。
- **g2 pass**："同步(手机 ↔ 电脑)"可展开，含 立即同步 / 重置游标(全量重拉) / 上次同步状态。截图 `iter0-g-settings-sync.png`。
- **g3 pass**："数据安全:访问码 · 历史回滚 · 快照"可展开，含 访问码设置、历史回滚列表、每日快照/导出 JSON/CSV/导入。截图 `iter0-g-settings-security.png`。

## 收尾核对 — pass ×2

- **z1 pass**（22:48）：records 可见 **8 条**且数值与基线一致（体重 89.4/89.1/88.9/88.7/88.5、体脂 25.8/25.1、腰围 96）；workouts 可见 1（快走 35min）；habit_logs 可见 2（h_d1/h_s1 done=1）；profile `current_stage_id=s1`、stage_history 0 条。
- **z2 pass**：全量 pull 与 `baseline-sync-pull.json` 逐文档比对：**46 个基线文档可见性零差异**；基线后新增 5 个文档（R1、R2、h_d2 打卡、测试-压腿 workout、测试-压腿 exercise）**全部为 deleted=true 墓碑**。history 由 50 条增至 59 条，属追加式设计预期。

---

## 缺陷候选与观察项

### D1（中低危）恢复"删除"类型历史版本会生成 data 为空的可见记录
- 复现：设置 → 数据安全 → 历史回滚 → 查看最近历史 → 任一标记为"删除"的行 → 点"恢复此版本"。
- 实测（22:46，`qa/tools/probe-restore-delete.mjs`）：`POST /api/history/56/restore` 返回 ok 后，`GET /api/tables/records` 出现 `{"data":{},"deleted":false}` 的可见文档；UI 最近记录将渲染出指标/数值/时间全空的坏行，并随同步污染其他端。
- 根因：UI 软删除推送 `data:{}`（`queueWrite(table,id,{},{deleted:true})`），删除历史行的 data 为空对象；`/api/history/{seq}/restore` 仅挡 `data is None`。
- 建议：恢复"删除"行时自动改取该 doc 上一条非删除版本；或服务端拒绝 data 为空的恢复。测试痕迹已清理（R2 重新置为墓碑）。

### O1（低危观察）首装首屏竞态可保存出无单位记录
- 本轮 b1 在全新浏览器档案（IndexedDB 为空）下于字典拉取完成前极速保存，记录 `unit:""`（正常应为 `"kg"`），最近记录显示"77.77"无单位。上轮同一 UI 路径（字典已就绪）为 `unit:"kg"`。
- 建议：`save()` 在 `metrics()` 未就绪时按 metric_code 兜底单位，或禁用保存至字典加载完成。

### O2（信息，非本轮引入，未改动）服务端存在更早遗留的探测数据
- `probe/x` 文档（`updated_at:"1"`）在基线快照中即存在；`seed_bf1` 的 `updated_at` 已变为 13:31:30 且带一条 seq=50 `device:"restore"` 历史（数据内容与原始一致，无信息丢失）。不影响可见数据与判定，建议数据所有者确认是否清理。

### 测试方法备注
- 上轮遗留 R1 已在本轮 d4 以 UI 删除路径清理；"最近训练"无遗留测试数据（本轮 e2 前可见 workouts 仅基线 1 条）。
- 已知环境坑复核：页面后台节流使选择器级 `click()` 超时不可靠，本报告全部 UI 操作走 `Runtime.evaluate` 内 `el.click()`；IndexedDB 挂起自愈未触发（无挂起场景）。
- 测试工具与脚本：`qa/tools/cdp.mjs`（CDP 驱动）、`step-b1/b2b3/c3/d/d4/e/fg/g-shot/z.mjs`、`probe-restore-delete.mjs`；如需回归可直接重跑。

**基线已恢复：本轮所有自建数据均已转墓碑，服务端可见数据与测试前基线完全一致。**
