# 迭代4 收官审计报告

> 监督员 · 2026-10-26 · PM 存档入库。

**结论：通过**

迭代4 四项交付（测量提醒 / 开机自启 / Tailscale 指南 / 电脑端宽屏）与声明一致，岗位边界基本清晰，QA 16/16 与视觉复验证据齐备，线上服务实测无异常，缺陷台账 O4 与 QA 报告口径一致。仅 2 条轻微流程备注（不构成保留事由）。

## DoD 核查表

| DoD 项 | 证据 | 判定 |
|---|---|---|
| QA 16/16 通过 | qa/reports/iter4-verify-report.md（134 行）16 项全 pass、0 新增缺陷；5 张截图与 iter4-reminders-api.json 均在 qa/reports/ 实际存在 | ✓ |
| 视觉验收通过（复验后） | 首轮 1 fail（宽屏双列失衡 433px）→ 修复提交 b1bfb82 新增 frontend/src/balance.js（JS 贪心均衡）→ 复验截图 iter4-desktop-1280-fixed.png 入库；审计从代码层面独立确认 | ✓ |
| 监督员审计 | 即本报告 | ✓ |
| PM 集成 | dist 时间戳晚于修复；bundle 实测含 balance 逻辑（wm-synced）、横幅文案、min-width:1024 媒体查询；/api/reminders 与 /api/insights 均 200 | ✓ |

## 分项核实

1. **提交与岗位边界**（336412b → b1bfb82）：336412b 按声明分片（后端 reminders/前端提醒通知宽屏/PM 指南脚本 README）；584f18c 全为 qa/**；b1bfb82 为修复+复验证据同框；e180783 知识汇总原始稿撤出属用户要求。工作区干净，无无主未提交工作。
2. **代码抽查**：backend/reminders.py 与声明完全相符（weight 每日、waist 每周≥7 天、停用指标跳过、名称取自 metrics、纯读取无写入）；frontend/src/balance.js **移动范围有硬约束，无法波及 .cols 之外**——reconcile 只遍历两个 .col ref 的直接子元素且必须过 isCard（classList.contains('card')）才登记，apply 只把已登记卡 appendChild 回这两个 .col；Today/Coach 模板中 h1 与 page-head 均在 .cols 之外——此前"页头被移动"确系截图伪影，代码层面排除可能。
3. **服务实测**：GET /api/reminders 200（weight due="今天还没有记录"、waist 不 due="1 天前测过（10-25）"，与真实数据预期一致）；GET /api/insights 200（蛋白质 124g）；records 8 条基线无残留；manifest 200。
4. **scripts/ 三件套安全**：autostart.bat 无危险命令、无密钥、路径全带引号；install/uninstall 只创建/删除 Startup 固定名称快捷方式，免管理员；Startup 快捷方式独立核验存在（Test-Path=True）。
5. **台账与文档**：O4 口径一致；README 四项新功能均有说明；tailscale-guide.md 46 行完整。

## 越权与偏差清单

1. [轻微] 336412b（开发提交）混入 qa/reports/iter4-desktop-widescreen.png（qa/** 为 QA 岗产物；属截图产物非业务代码，QA 报告已注明"代入库"，不判违规，下不为例）
2. [轻微] b1bfb82 提交标签 [前端][QA][PM] 与实际文件不符（无 PM 产出），标签冗余无实质影响

## 新岗位申请

无。

## 流程改进建议（PM 已采纳）

1. O4 闭环排期：autostart.bat 加端口占用检测，列入迭代5 后端任务，QA 回归加"重复 install+自启不产生第二实例"断言
2. 列平衡纳入自动化断言：QA 增加 DOM 断言脚本（1280 宽两列底差 ≤ 单卡高、.cols 外元素未被移动），根治截图伪影类争议
3. 提交标签与文件归属一一对应；代入库他人产物需在提交信息注明"代入库"
