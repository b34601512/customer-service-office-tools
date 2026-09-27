# 25号 京东换货登记核查（上门换新取件）

## 这个项目干什么

京东「**上门换新**」= 京东仓直接给客户换出**新机**（平台订单实付 ¥0），
但客户那台**故障机还要寄回我们工厂** → 客服必须在金山
[《2026年【湖南怀化售后】对接表》](https://www.kdocs.cn/l/ccj1mhG3wLy6) →「**换货维修登记表**」登记一条，
工厂才知道这台机器是谁寄回的。

登记不规范会**白亏一台机器**：登记了换新又填了客户地址，工厂看登记可能再寄一台 → 重复换货。
所以规范是：**三个选项（质保标准 / 客户寄给厂家的运费 / 厂家寄给客户的运费）都选「无需处理」+ 客户地址列不填**。

本项目只做**只读检查**：找出「没登记」和「登记不规范」的单，出报告 + 一段发群话术（**发出去前先问用户**）。

## 怎么跑

```bash
# ① 取数（京东自主售后：客户期望=换货 + 售后状态=完成 → 本地筛「上门换新取件」→ 最近 30 天）
node src/tools/jd-exchange-list.js --store jd1
node src/tools/jd-exchange-list.js --store jd3 --days 30

# ② 登记核查（金山「换货维修登记表」按订单号查 + 判「地址列空 / 三项无需处理」）
node scripts/复查京东上门换新登记.js                    # 读各店最新清单
node scripts/复查京东上门换新登记.js --stores jd1,jd3

# 自检
node --test
```

产物：`runtime/jd/上门换新取件清单-<店>-<时间>.json`、`runtime/review/复查报告-上门换新登记-<时间>.md/.json`

## 关键口径 / 坑（详见 `经验/`）

- 「上门换新取件」不是商品名、也不是服务标签（标签叫「可能上门换新」）→ 只能按行里的
  `pickWareFacetDTO.pickWareTypeName == "上门换新取件"` 本地筛。
- 金山「换货维修登记表」**2.8 万+ 行**，网页端只能读前 1.85 万行（够不着最新登记）→ 用 AirScript 按订单号查。
- 金山老脚本只返回非空单元格（**列位置丢失**）→ 判不了「地址列是否为空」；**脚本 2026-09-27.2 起返回 `cells`（列号+值）**，
  名字、地址、选项都能精确定位（脚本在 `kdocs-scripts/AirScript-只读查询订单号.md`，粘到上面那份对接表里）。
- 京东后台的坑（照 24号 经验）：筛选控件必须**真实鼠标点**；默认 tab 是「待审核」，要先切「全部」；切完 tab 筛选区收起，要重新点「展开」。
- 浏览器登录态按店铺隔离（`runtime/state/browser-profiles/jd/<店>`），端口 9450-9454。

## 目录

- `src/tools/jd-exchange-list.js` 京东取数；`scripts/复查京东上门换新登记.js` 登记核查
- `src/engine/`（浏览器、金山网页读、AirScript、日志）、`src/config/stores.js`（店铺/端口/profile）
- `project-config/`（不入库：stores.json、kdocs-airscript.json、wecom-notify.json）
- `kdocs-scripts/` 金山 AirScript 源码；`tests/` 反向断言测试
