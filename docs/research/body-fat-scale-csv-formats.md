# 体脂秤数据导出格式调研

> 调研员A · 2026-10-25 · 服务于迭代1（健康数据导入）。此为调研员交付原文，PM 存档入库。

调研对象为中国大陆主流体脂秤/健康 APP 的体重、体脂历史数据导出能力，供 FastAPI 后端 CSV 导入功能设计参考。

## 各 APP 明细

### 1. 华为运动健康（华为体脂秤）

| 项目 | 结论 |
|---|---|
| 是否支持导出 | 支持，但入口很深：走"数据副本"申请流程 |
| 导出入口 | 路径一：运动健康 App → 我的 → 点击头像进入帐号中心 → 个人信息 → 隐私/申请数据副本；路径二：华为隐私中心网页"获取您的数据副本"，需多重身份验证。未查到公开的网页版查看体重数据的入口 |
| 导出格式 | ZIP 压缩包（密码解压），核心数据为 **JSON 文件**（非 CSV） |
| 数据包结构 | 含多个 APP 的数据目录；体重体脂在 "Health detail data & description" 文件夹的 JSON 中。默认只导出近 1 年，联系客服最多可申请近 5 年，约 7 天后可下载 |
| 字段（JSON 结构，来自开源解析代码） | 记录类型 `type == 10006` → `samplePoints` 数组 → 取 `key == "WEIGHT_BODYFAT_BROAD"` 的采样点 → 其 `value` 是**内嵌 JSON 字符串**，再解析出：`bodyWeight`（kg）、`bodyFatRate`（%）；时间戳为采样点的 `startTime`（**毫秒级 Unix epoch**）；含 `subUser`（家庭成员/用户ID）字段，导入时需按人去重 |
| 日期格式 | 毫秒时间戳，需自行转本地时间 |
| 单位 | 字段值本身带单位约定（kg / %），无单独单位列 |
| 附加指标 | 官方 App 内可查看脂肪率、骨骼肌量等；导出 JSON 中体脂率确认存在，肌肉量等字段名未逐一确认 |
| 来源 | [GitHub: huawei-health-to-health-connect（含解析源码 main.py）](https://github.com/christianeirich/huawei-health-to-health-connect)、[FitConverter 华为导出教程](https://www.fitconverter.com/convert/export/huawei.html)、[知乎教程](https://zhuanlan.zhihu.com/p/602266990) |

### 2. 小米运动健康 / Mi Fitness（小米体脂秤）

| 项目 | 结论 |
|---|---|
| 是否支持导出 | 支持，官方隐私中心渠道 |
| 导出入口 | 登录 https://account.xiaomi.com/ → 隐私 → 管理您的数据 → MI Fitness（小米运动健康）→ 下载，验证后生成 ZIP 并发邮件通知（官方页面：[mi.com 支持文档 KA-16576](https://www.mi.com/tw/support/article/KA-16576)、[FitConverter 小米教程](https://www.fitconverter.com/convert/export/xiaomi.html)）。App 内仅运动记录可导出 GPX/TCX，体重无 App 内导出 |
| 导出格式 | ZIP（带密码，密码在下载页提供），内含 **CSV 文件**为主，文件名形如 `XXX_MiFitness_hlth_center_sport_record...csv`、`XXX_MiFitness_hlth_center_fitness_data...csv` |
| 列名原文 | **未查到公开的"身体测量/体重" CSV 具体列名**。导出包是否包含体重体脂 CSV，公开教程未逐一列出（多数教程只关心运动数据） |
| 附加佐证 | 第三方工具 [mi_fitness_data_bridge](https://github.com/shkyyy18/mi_fitness_data_bridge) 从小米云端取 body_measurements 数据，字段有 `weight_kg`、`body_fat_pct`、`water_pct`、`muscle_rate`（%，它自己换算 `muscle_mass_kg = weight_kg * muscle_rate / 100`）、时间戳为 ISO 格式（如 `2026-07-15T23:30:00`）。这反映小米身体测量数据的字段语义，但**不是官方导出 CSV 的列名原文** |
| 来源可信度 | 入口为官方文档；CSV 列名为未证实 |

### 3. Keep

| 项目 | 结论 |
|---|---|
| 是否支持导出 | **无自助导出入口**，需联系人工客服或发邮件申请 |
| 导出入口 | Keep App → 我的 → 帮助中心 → 在线客服；或发邮件至 privacy@keep.com |
| 导出格式 | Excel（xlsx）附件，邮件发送 |
| 内容 | 以运动记录为主（记录概况、心率），**官方导出中未见体重数据列** |
| 体重数据 | Keep 支持记录/同步体重（可接华为运动健康、Apple 健康等），但自身不提供体重导出 |
| 来源 | [FitConverter Keep 导出页](https://www.fitconverter.com/convert/export/keep.html)（用户经验帖） |

### 4. 云康宝 Yolanda（轻牛健康 App）

| 项目 | 结论 |
|---|---|
| 是否支持导出 | **未查到公开的导出功能说明** |
| 导出入口 | 未查到。可行替代：iOS 端可同步 Apple 健康后走苹果导出；或联系客服申请数据副本（PIPL 赋予的权利） |
| 配套 App | 国内为「轻牛健康」（`com.qingniu.plus`），海外为 Yolanda/Unique Health |
| 来源 | [轻牛健康 App Store 页](https://apps.apple.com/cn/app/id1436583353)、[云康宝官网](https://www.runcobo.cn/news.html)。格式：未查到公开格式 |

### 5. 有品 Picooc

| 项目 | 结论 |
|---|---|
| 是否支持导出 | **未查到 App 内自助导出入口** |
| 官方数据通道 | 官方隐私政策确认：经用户授权，体重、体脂率、BMI、去脂体重等身体体征数据可同步至 **Apple HealthKit**（[有品隐私政策](http://picooc.com/privacy.html)、[PICOOC App Store 页](https://apps.apple.com/cn/app/id729928969)） |
| 可行路径 | iOS：同步到苹果健康 → 健康 App 导出 export.zip。Android：联系客服申请数据副本 |
| 格式 | 未查到公开格式 |

### 6. 荣耀运动健康（荣耀体脂秤）

| 项目 | 结论 |
|---|---|
| 是否支持导出 | 支持，官方隐私声明明确写出入口 |
| 导出入口 | **官方声明原文：我的 > 账号头像 > 隐私中心 > 个人数据副本提取**（来源：[荣耀官方隐私声明](https://agreement.itsec.hihonor.com/asm/agrFile/getHtmlFile?agrNo=1070&country=cn&branchId=13&langCode=zh-cn)） |
| 数据范围 | 声明中"体重管理数据"包括：体重、体脂量、体脂率、阻抗、BMI、肌肉量、基础代谢、身体年龄、骨骼肌量、水分率等 |
| 导出格式/列名 | **未查到公开的导出文件格式与列名**（声明只保证可获取个人信息副本） |
| 其他 | 体脂秤离线测量数据在蓝牙连接后同步进 App；需开启"我的 > 隐私管理 > 同步健康数据"（[荣耀支持页](https://www.honor.com/cn/support/content/zh-cn15835454)） |

### 7. 苹果健康 Apple Health（iOS 导出）

| 项目 | 结论 |
|---|---|
| 是否支持导出 | 支持，官方功能，所有接 HealthKit 的秤（有品、云康宝、香山、沃莱等）数据都汇于此，是**最重要的兜底导入来源** |
| 导出入口 | iPhone 健康 App → 摘要/右上角头像 → 导出所有健康数据 → 生成 export.zip（官方文档：[Apple 支持](https://support.apple.com/zh-sg/guide/iphone/iph5ede58c3d/ios)） |
| 导出格式 | ZIP，核心为 **export.xml**（另含 export_cda.xml、workout-routes/*.gpx、electrocardiograms/*.csv）。中文系统导出的文件名可能是"导出.xml"，需兼容改名 |
| 关键字段（Record 标签） | `type`、`unit`、`value`、`startDate`、`endDate`、`sourceName`。相关 type：`HKQuantityTypeIdentifierBodyMass`（体重，unit `kg`）、`HKQuantityTypeIdentifierBodyFatPercentage`（体脂率，unit 为 `%` 但 **value 是 0~1 小数**，如 0.213 表示 21.3%，解析时必须乘 100）、`HKQuantityTypeIdentifierLeanBodyMass`（去脂体重）、腰围为 `HKQuantityTypeIdentifierWaistCircumference`（cm，若源 App 写入） |
| 日期格式 | `startDate="2026-10-25 07:30:00 +0800"`，即 `yyyy-MM-dd HH:mm:ss Z`（含时区偏移的字符串） |
| 来源 | 官方导出方式 + [解析教程（peanut996）](https://peanut996.com/apple-health-with-grafana)。Record 属性格式为社区/开发者共识，体脂率小数取值建议在实测样本上复核 |

### 8. 其他补充

- **沃莱 ICOMON（OKOK App，`com.chipsea.btcontrol`）**：未查到原生 CSV 导出功能说明；iOS 可同步 Apple 健康；开源项目 [openScale](https://github.com/oliexdev/openScale) 支持蓝牙直连部分秤并导出 CSV。来源：[OKOK App Store 页](https://apps.apple.com/cn/app/id999308991)。
- **香山 CAMRY（香山智能 App）**：未查到原生导出功能说明；官方 App Store 页确认**支持存储数据至苹果健康**，可间接导出。来源：[香山智能 App Store 页](https://apps.apple.com/mo/app/id1529852280)。
- **openScale CSV（重要参考格式）**：开源体脂秤 App，其导出 CSV 与本系统指标高度契合。表头为 19 个英文列：`biceps, bone, caliper1, caliper2, caliper3, calories, chest, comment, dateTime, fat, hip, lbm, muscle, neck, thigh, visceralFat, waist, water, weight`；日期 `YYYY-MM-DD HH:MM`；逗号分隔；**包含 waist（腰围）、hip（臀围）、visceralFat（内脏脂肪）**。注意旧版本导出**无表头行**，需按固定列序解析（[openScale wiki 导入脚本](https://github.com/oliexdev/openScale/wiki/Useful-import-scripts)、[issue #145](https://github.com/oliexdev/openScale/issues/145)）。

## 格式共性总结

1. **没有统一格式，三大形态**：华为 = 毫秒时间戳 + 嵌套 JSON；小米隐私包 = CSV（列名未公开）；苹果健康 = 属性化 XML。中国大陆厂商几乎没有"中文列名 CSV"的公开先例，设计导入器不应假设存在统一中文模板。
2. **字段语义集中在 4~8 个**：weight(kg)、bodyFatRate/fat(%)、muscle(率或量，注意有的源给百分比需乘体重换算)、water(%)、bone(骨量)、visceralFat(内脏脂肪等级)、waist/hip(腰围/臀围)。BMI、BMR 常见但可由我们自行计算。
3. **日期时间常见三种**：Unix 毫秒时间戳（华为）、ISO 8601 字符串、`yyyy-MM-dd HH:mm[:ss][ Z]`（openScale、苹果健康）。`YYYY/MM/DD HH:mm` 斜杠格式在中文 Excel 手工整理的表格中最常见。
4. **单位基本内嵌于字段语义**（列名后缀 `_kg`、`_pct` 或 App 约定），极少有单独单位列；**体脂率要警惕 0~1 小数与 0~100 百分比两种口径**（苹果健康为小数）。
5. **多家庭成员问题普遍**：华为 JSON 含 `subUser`，苹果健康 Record 有 `sourceName`，openScale 有用户维度——导入时需要"按人分组/指定归属人"。
6. **体脂秤数据常经由 Apple Health 中转**：有品、云康宝、香山、沃莱均支持写入 HealthKit，因此支持"苹果健康 export.zip 导入"可一次性覆盖多家设备用户。

## 对导入器的建议

1. **优先支持三个解析器**（覆盖面/实现成本比最高）：
   - **苹果健康 export.zip**（XML 解析）：官方标准、覆盖所有 iOS 生态秤；解析 `<Record>`，按 `type` 映射，体脂率乘 100，时间解析 `yyyy-MM-dd HH:mm:ss Z`。
   - **华为运动健康数据副本**（JSON 解析）：递归找 `type==10006` → `samplePoints` → `key=="WEIGHT_BODYFAT_BROAD"` → `json.loads(value)` 取 `bodyWeight`/`bodyFatRate`/`startTime`（毫秒）。
   - **通用 CSV/Excel**：服务绝大多数手工整理和未知厂商（含小米隐私包解出的 CSV、openScale CSV、客服要来的 Excel）。
2. **CSV 解析器按"列名映射表 + 自动识别"设计**：
   - 同义词映射表，weight 列候选：`weight`、`weight_kg`、`体重`、`体重/kg`、`体重(kg)`、`重量`；fat：`fat`、`body_fat_pct`、`bodyFatRate`、`体脂率`、`体脂率/%`、`体脂`；muscle：`muscle`、`muscle_mass_kg`、`肌肉量`、`骨骼肌量`；waist：`waist`、`腰围`、`腰围/cm`；hip：`hip`、`臀围`；visceralFat：`visceralFat`、`内脏脂肪`。匹配时做 strip、去单位后缀、全半角与下划线归一化。
   - 表头缺失时（openScale 旧版导出无表头）提供按固定列序的 fallback profile，并在 UI 让用户确认列含义预览。
   - 单位列（若有单独`单位`列或列名带 lb/斤）做换算：1 斤 = 0.5 kg，1 lb = 0.45359237 kg；体脂率 >1 的按百分比，<=1 且非 0 的按小数提示或乘 100。
3. **日期时间自动识别链**：依次尝试 Unix 毫秒（纯数字且 >10^12）、Unix 秒、ISO 8601、`YYYY-MM-DD HH:mm[:ss]`、`YYYY/M/D H:mm`、`DD/MM/YYYY`、`MM/DD/YYYY`（后两者有歧义，超 12 的字段可判别，歧义行报 warning 而非失败）。导入前按"时间戳重复去重 + 合理范围校验（体重 20~400 kg、体脂率 2~80%）"过滤。
4. **产品层兜底**：提供可下载的 CSV 模板（列：`时间, 体重/kg, 体脂率/%, 腰围/cm, 臀围/cm`）；对 Keep、云康宝、有品用户给出"先同步到苹果健康/华为运动健康再导出"的引导文案。
5. **技术形态**：每个来源一个 Parser 类（`AppleHealthParser`、`HuaweiJsonParser`、`GenericCsvParser`），统一输出 `Measurement(datetime, weight, body_fat, muscle, waist, hip, visceral_fat, source_name)` 列表，入口做格式探测（zip→找 export.xml 或 *.json 目录 / csv / xlsx）。xlsx 用 openpyxl 读后走同一条 CSV 管道。

## 信息可信度说明

| 可信度 | 内容 | 来源类型 |
|---|---|---|
| 官方文档 | 华为/荣耀/小米/苹果的导出入口路径；荣耀隐私声明；有品隐私政策（数据写入 HealthKit）；香山/沃莱同步苹果健康的说明 | 厂商官网、官方隐私声明、App Store 官方页面 |
| 开源代码（高可信，非官方规格） | 华为 JSON 结构（type 10006、WEIGHT_BODYFAT_BROAD、bodyWeight、bodyFatRate、startTime 毫秒）；openScale CSV 19 列表头与无表头问题；小米云端 body_measurements 字段语义 | GitHub 开源项目 |
| 用户经验帖（中等可信） | 华为导出约 7 天、默认 1 年/最多 5 年；小米隐私包为带密码 ZIP 含 `MiFitness_hlth_center_*.csv`；Keep 需客服/邮件导出且仅 Excel 运动记录 | FitConverter、知乎/CSDN 教程 |
| 未能证实（勿按此硬编码） | 小米官方导出 CSV 的确切列名；荣耀副本的文件格式；云康宝、有品、香山、沃莱的原生导出格式；苹果健康 export.xml 完整官方规格（体脂率小数口径建议实测样本复核） | 标注"未查到公开格式" |
