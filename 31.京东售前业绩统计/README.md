# 31.京东售前业绩统计

> 立项 2026-10-07（黎路遥）：把京东店铺后台的客服业绩数据**追加**进两张汇总表，给财务算提成（上个月整月批次）。

## 目标物（只追加、保留历史）

| 表 | 链接 | 内容 |
|---|---|---|
| 表A《京东客服询单业绩汇总（客服管家数据）》 | <https://www.kdocs.cn/l/cb5T52wn41g4> | 『明细』14 列；京东1、2、3、8、5S、6店 |
| 表B《京东客服询单业绩汇总（魔方数据）》 | <https://www.kdocs.cn/l/cu7zHq02feWI> | Sheet1 13 列；京东1、3店 |

两表当前数据：表A 到 2026-08（2869 行，年月=2026-07/08）；表B 到 2026-08（1648 行）。**本次批 = 2026-09 整月**。

## 两个数据来源

1. **客服管家**（系统数据，可能漏统计）：后台【客服→店铺数据→营销明细→客服促成】导出「促成订单_<hash>.xlsx」→ 表A。
   口径：去「已取消」；昵称去「(推算)」后缀后匹配客服实名（《客服昵称对应姓名》子表 + 表A 历史行）。
2. **魔方**（京东官方插件，补管家漏的）：【数据分析→成交分析→客服销售分析】导出「客服销售分析_起_止_全部客服.xlsx」→ 表B。
   口径：去「已取消」；去 0 金额（`--保留零金额` 可留——8 月人工批次实际保留了 0 元行，待黎路遥确认本次口径）。

## 数据链与用法

```
下载（31号专属，2026-10-07 打通）
  → node src/tools/jd-客服管家-促成订单-导出.js --year-month 2026-09   # 6 店 → runtime/downloads/<年月>/jd1_促成订单_2026-09.xlsx + manifest.json
  → node src/tools/jd-魔方-客服销售分析-导出.js --year-month 2026-09   # jd1/jd3 → …_客服销售分析_….xlsx + manifest-魔方.json
导入
  → node scripts/导入管家数据.cjs --manifest runtime/downloads/2026-09/manifest.json --dry-run   # 先看统计/映射
  → node scripts/导入管家数据.cjs --manifest runtime/downloads/2026-09/manifest.json --send      # 分批追加 + 写完自动回读核对
  → node scripts/导入管家数据.cjs --manifest runtime/downloads/2026-09/manifest.json --verify    # 随时再核对（应有=实有）
```

### 下载工具（只读：导航/查询/点导出/下载；登录失效→留窗口跳过）
- 管家：页面内调 `kf.jd.com/offlineDownload/addTask?type=2`（=点「导出excel」）→ 轮询 `getTaskStatus` 拿签名地址 → 下载。不用点日期控件（接口直接吃 startTime/endTime）。
- 魔方：`joyi.yiyitech.com`（九易，京东服务市场 app FW_GOODS-908622）。**登录态**存在 localStorage `joyi_token`；
  失效时从魔方首页点「现在登录」→ 京东 SSO 授权页（勾《用户授权协议》→ 点登录）——**别直接开 OAuth 链接**（会落到 gwjoyi 的「服务器出错了」页）。
  导出走「导出中心」：页面 `exportExcelTask()` 建任务 → 列表里等 **3~4 分钟**变「完成」→ 点该行「下载」（浏览器下载事件落盘）。
- 店铺 profile 为 31号 专属：`runtime/state/browser-profiles/jd/<key>`（2026-10-07 从 9号/22号 已登录 profile 引导复制），端口 9470-9475，见 `project-config/stores.json`。
- 可选参数：`--store jd1`（单店）、`--dry`、`--out <目录>`、`--保持窗口`。

### 导入脚本参数
- 管家文件可省 `store`（按昵称前缀自动识别：德达官方旗舰店→1店、dedakj旗舰店→2店、dedakj器械店→3店、dedakj个护→8店、dedakj保健器械→5S店、dedakj自营→6店）；魔方文件必须给 `store`（文件里没有店铺）。
- 其他参数：`--batch 500`、`--刷新映射`（重读实名映射）、`--probe`（看云端末行/表头）、`--跳过前 N`（续写：前 N 行已写入，只补剩下）、`--只发 jd5s`（补单店；核对仍全量）。

清单示例（`runtime/downloads/2026-09/manifest.json`）：
```json
{
  "yearMonth": "2026-09",
  "files": [
    { "file": "C:/…/促成订单_xxx.xlsx", "store": "京东1店" },
    { "file": "C:/…/促成订单_yyy.xlsx" }
  ]
}
```

## 安全设计（不许改坏）

- 云端两个 AirScript（《脚本大全》第 14 行 `append_guanjia`、第 15 行 `append_mofang`）：**只从末行+1 追加，绝不覆盖/清空**；表头守卫；`allowWrite` 门；`expectedLastRow` 防重复；写完回读逐格比对。
- **v2026-10-07.2（防日期解析）**：B/C/D/E/I（管家）、B/C/F/G/H/K/L（魔方）写前强制文本格式——2026-10-07 首跑踩坑：常规格式下 `2026-09`/`2026-09-30 22:32:26` 被金山存成日期序列号，回读不一致停手。
- **repair 模式（两个脚本都有）**：对指定区间先设文本格式、按传入行重写 A~N/A~M、回读逐格比对；`expectFirstA` 防错位、区间不得超出当前末行；用于修复已写入的日期型行（管家 2871~3370 共 500 行）。
- 本机测试：`node tests/AirScript追加写入.test.cjs`（27 项，含日期解析 mock + repair 守卫）。
- 导入脚本默认 `--dry-run`；有未匹配昵称/跨文件重复键/回读不一致 → 一律停下，不自动重试。
- 电商平台后台只读（只点查询/导出，不改任何数据）；webhook/令牌存本机 `project-config/*.local.json`（不入库）；不替用户粘贴脚本。

## 现状（2026-10-07 夜）

- ✅ **下载打通**：管家 5/6 店已下（jd1 830 / jd2 30 / jd3 439 / jd8 18 / jd6 222 行，落 `runtime/downloads/2026-09/`）；jd5s 未登录（窗口停在登录页，等人工）。魔方 jd1/jd3 工具已就绪，**等人工点一次 OAuth 授权**（窗口停在授权页）。
- ⚠ **管家导入部分完成（500/1286 行）+ 踩坑停手**：首跑 v1 脚本 B/C/D 被当日期解析（回读不一致），按设计停手；**v2 已备好待黎路遥重贴** → 跑 `scripts/修复管家日期列.cjs`（修 2871~3370）→ `导入管家数据.cjs --send --跳过前 500`（补 786 行）→ 核对。
- ⏳ 魔方导入未开始（等下载 + v2 魔方脚本重贴）。
- 细节与证据：`失败台账.md`（2026-10-07 31号 条目）、`断点记录.md`、任务回执。

## 文件地图

- `src/tools/jd-客服管家-促成订单-导出.js`、`jd-魔方-客服销售分析-导出.js`：31号专属只读下载工具。
- `src/config/stores.js`、`src/engine/browser.js`、`project-config/stores.json`：店铺 profile/端口配置（薄壳共用仓库根 `tools/浏览器引擎`）。
- `scripts/修复管家日期列.cjs`：用 AirScript v2 repair 模式修复被日期解析的区间（修复后在线复核 B/C/D）。
- `kdocs-scripts/AirScript-管家数据-追加写入.md`、`…-魔方数据-追加写入.md`：云端追加脚本正文（源，v2026-10-07.2）。
- `scripts/导入管家数据.cjs`、`导入魔方数据.cjs`：本地映射+分批追加+回读核对。
- `scripts/金山只读.cjs`、`AirScript调用.cjs`：24号 读表薄壳 / webhook 调用器（含令牌回退链）。
- `tests/AirScript追加写入.test.cjs`：两个云端脚本的本地 mock 测试（27 项）。
- `project-config/links.local.json`、`kdocs-airscript.local.json`：本机配置（不入库）。
