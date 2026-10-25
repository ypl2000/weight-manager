# 迭代0 基线审计报告

> 监督员 · 2026-10-25 · PM 存档入库。审计对象为迭代0全部交付与流程合规性。

## 结论：**有保留通过**

迭代0 四项 DoD 中三项实质达标，PM"提交中无业务代码改动"的声明经 git --stat 核实为真；保留事项有二：① DoD 第 4 项中 profile"男/172"与服务端基线、种子脚本均不符（详见核查表）；② QA 最终交付物（执行报告、qa/tools/、5 张截图）尚未由 PM 集成入库。缺陷 D1 属 backend 范围、已转派，按要求不计入本次判定。

## DoD 核查表

| # | DoD 项 | 证据 | 判定 |
|---|---|---|---|
| 1 | git 初始化 + v1 基线提交 | 提交 3ce1e77（28 文件 4414 行），tag `v1.0-baseline` 经 `git rev-parse` 确认指向该提交；全程仅 2 个提交、master 单分支 | ✅ 通过 |
| 2 | 两份调研报告入库 docs/research/ | `body-fat-scale-csv-formats.md`（14KB：逐家导出能力、格式、字段、来源链接）；`glm-5.3-flash-api.md`（7.8KB：模型 id、端点、SDK 兼容性、能力表、计费表、调用建议，含"Coding Plan 额度不可用于自建应用"关键结论）。均有实质内容与溯源 | ✅ 通过 |
| 3 | QA 冒烟清单 + 执行报告 | `qa/smoke-checklist.md` 已随 5b67cd4 入库；`qa/reports/iter0-smoke-report.md` 实质完整：24/24 逐链路结果、每项含时间戳/接口断言/截图编号、z1/z2 收尾核对、D1/O1/O2 附复现与根因 | ✅ 通过（报告本体当时未入库，PM 随本轮收尾提交） |
| 4 | 基线数据完好 | 经 GET /api/tables/records|workouts|habit_logs|profile 独立核对：records 恰 8 条可见且数值逐一吻合；workouts 1（快走35min）；habit_logs 2；profile current_stage_id="s1"。**但 profile 实际为 gender:""、height_cm:null，并非"男/172"**。QA 测试前基线快照及 backend/seed.py 种子值均为空——即"男/172"从未存在于服务端，系 PM 的 DoD 描述错误，非迭代期间丢失 | ⚠️ 有保留：数据本体完好，DoD 文字描述与事实不符（PM 已确认修正基线描述） |

## 越权与偏差清单

- PM 提交内容：5b67cd4 仅含 docs/research×2、qa/reports×4、qa/smoke-checklist.md，无业务代码改动，声明属实。3ce1e77 含全量业务代码，属基线导入，合规
- 工作区：对已跟踪文件零修改，无任何角色在库内顺手改业务代码
- qa/tools/：11 个 .mjs 全部位于 qa/** 内，符合 QA 岗位边界
- 调研员：报告转存路径合规
- 其余：未发现越权

## 数据卫生发现

1. O2 遗留：`probe/x` 文档仍可见（data:{}）；`seed_bf1` 的 restore 历史（seq=50）确认存在，数据内容与原始一致。PM 已认领并限期迭代0收尾清理（probe/x 当轮已清；restore 历史属追加式审计设计，保留）
2. 根目录《知识汇总.md》《知识汇总-整理版.md》为无主文件：疑似数据所有者自放素材，需 PM 与所有者确认归属（移入 docs/ 或保持原位）
3. 小疵：QA 报告总览写"观察项 3 项"，正文仅列 O1、O2（疑似把 D1 计入），已随存档说明
4. history 追加式增长符合设计，无异常

## 新岗位申请

无。

## 流程改进建议

1. 建立轻量缺陷台账 qa/defects.md（编号/负责人/状态/期限）——PM 已采纳并于本轮建立
2. PM 收口迭代0：将 QA 报告、qa/tools/、截图提交入库后再宣布迭代0关闭，并对收尾态补一份全量快照作为迭代1比对基线——PM 已采纳并于本轮执行
3. 修正 DoD 基线描述并确认 profile 归属——基线描述已修正（profile 性别/身高为空、阶段s1）；profile 的性别/身高应由数据所有者在应用"设置→个人资料"里自行填写
