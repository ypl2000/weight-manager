# v1 回归冒烟清单（iter0）

- 被测地址：http://127.0.0.1:8000（FastAPI + Vue PWA 体重管理）
- 执行方式：浏览器自动化（Chromium/Playwright）+ 服务端 API 断言，以服务端 API 状态为最终判定依据
- 测试数据约定：新增数据一律使用明显的测试值（体重 **77.77** kg、训练 **测试-压腿 7 分钟**），测试结束后删除，恢复基线
- 基线（测试前快照，测试后必须原样）：
  - records 8 条：体重 89.4/89.1/88.9/88.7/88.5，体脂率 25.8/25.1，腰围 96
  - workouts 1 条（快走 35 分钟）、habit_logs 2 条（h_d1、h_s1 当日 done=1）
  - profile：current_stage_id=s1；stage_history 为空
- 说明：history 审计表为追加式设计，测试会使其条目增加，属预期；软删除墓碑（deleted=true）不计入可见基线

## a) 记录链路（录入 → 列表 → 趋势）
- [ ] a1 打开 `#/data`（录入子标签），选择指标"体重"，输入 77.77，点击"保存记录"，出现"已保存"提示
- [ ] a2 "最近记录"列表出现新行：体重 **77.77 kg**
- [ ] a3 切到"趋势"子标签，图表渲染出画布且体重曲线含 77.77 数据点（截图为证）

## b) 同步链路（离线优先 + LWW + 软删除）
- [ ] b1 UI 保存 77.77 后 **3 秒内** `GET /api/tables/records` 可见该记录（快速同步 ≈1.5s）
- [ ] b2 LWW：以更旧的 `updated_at` POST `/api/sync` 推送同 id 旧版本，服务端不回滚为新写入（后写者胜）
- [ ] b3 UI 删除该测试记录后，服务端文档变为软删除 `deleted=true`（经 `/api/sync` cursor=0 全量拉取可见墓碑，GET 列表中不再出现）

## c) 阶段判定链路
- [ ] c1 `GET /api/stage-suggestion` 返回 `suggested:"s1"`，且每个阶段带规则明细（text/ok/detail）
- [ ] c2 阶段③"腰围 ≤ 85 cm(最近14天最新值)"为未命中（ok=false，detail 显示"当前 96 cm"）
- [ ] c3 `#/stage` 页"自动判定"分区展示建议结果与 ✓/✗ 规则明细（截图为证）

## d) 回滚链路
- [ ] d1 `GET /api/history` 有审计记录（含 table/doc_id/action/device）
- [ ] d2 选一条 records 的历史版本 POST `/api/history/{seq}/restore` 返回 ok
- [ ] d3 恢复后数据回到历史版本（软删除的测试记录被恢复可见），且 history 再新增一条（device="restore"）
- [ ] d4 清理：恢复出来的测试记录再次删除，恢复基线

## e) 习惯打卡与训练打卡
- [ ] e1 `#/` 今日页勾选一个未打卡的习惯 → `GET /api/tables/habit_logs` 新增当日 done=1 记录；随后取消勾选 → 该记录软删除（基线可见 2 条不变）
- [ ] e2 `#/training` 保存一条训练打卡（测试数据）→ `GET /api/tables/workouts` 数量 +1 且字段完整；随后 UI 删除 → 服务端墓碑，可见数量回到 1

## f) PWA 资源可访问
- [ ] f1 `/manifest.webmanifest` 返回 200
- [ ] f2 `/sw.js` 返回 200
- [ ] f3 `/icons/icon-192.png` 返回 200
- [ ] f4 页面可正常加载（首页标题"今日"渲染，无白屏）

## g) 设置页分区可展开
- [ ] g1 `#/settings` "AI 识别"分区可展开（含 base_url/模型名/API Key 字段）
- [ ] g2 "同步"分区可展开（含"立即同步/重置游标"）
- [ ] g3 "数据安全：访问码 · 历史回滚 · 快照"分区可展开（含访问码/历史/快照入口）

## 收尾核对
- [ ] z1 records 可见记录回到 8 条（数值与基线一致）；workouts 可见 1 条；habit_logs 可见 2 条
- [ ] z2 测试产生的其余文档均为 deleted=true 墓碑，不影响可见数据
