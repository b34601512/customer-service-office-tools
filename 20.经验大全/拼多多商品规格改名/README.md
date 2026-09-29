# 拼多多后台：商品规格（SKU 名称）改名路径（2026-09-29 实测）

## 结论：必须用**原生 Chrome + 调试端口 + CDP**，Playwright 自启（headless 或 charter）都不行

* 实测：Playwright `launchPersistentContext`（headless）打开 `goods_list` → 列表**渲染不出任何行**（`tbody tr` = 0），搜索框填词回车后仍 0 行；换 `?goodsId=` / `goods_edit?goods_id=` 等 URL 会**直接被弹回商品列表**。
* 换成原生 Chrome（`--remote-debugging-port=9338 --user-data-dir=<拼多多店铺画像>`）+ `chromium.connectOverCDP('http://127.0.0.1:9338')` → 列表 10 行正常渲染，行内动作（编辑/下架/商品数据/预览）都能拿到。**与 20号《风控平台人工登录》同一教训：平台能识别自动化浏览器。**
* 探测页面时 Chrome 必须**可见**（headless 原生 Chrome 未验证；本次用可见窗口成功）。

## 打开编辑页

1. 连上 CDP 后到 `https://mms.pinduoduo.com/goods/goods_list`；
2. 搜索框 `input[placeholder="请输入商品名称"]` 填关键词 → 点「查询」；
3. 行定位：`tbody tr` 里含 `ID: <商品ID>`（例：`ID: 909533194658`）；
4. 行内 `text=编辑` 点击 → 新标签打开编辑页，URL 形如：
   `https://mms.pinduoduo.com/goods/goods_add/index?id=<内部id>&goods_id=<商品ID>&type=edit`
   （**直接拼这个 URL 不行**：`id` 是点击时才生成的内部 id，缺了它会弹回列表。）

## 改 SKU（规格）名称

* 编辑页里「规格与库存」区块：**规格名称**（值形如 `院线雾化款1SW【9升流量+96%氧浓度+负离子灭菌】`）就是 SKU 名称，输入框 `ph="请输入规格名称"`；同一商品多个 SKU = 多个同 placeholder 输入框，**顺序与规格值一一对应**（要先截屏记录「输入框顺序 ↔ 规格值」）。
* 页面上还有「**Excel批量编辑规格**」入口（可批量改规格名称/编码/重量，未实测）。
* 改完要**提交商品**才算生效；改动可能进平台审核。**改前必须把原文本存档**（列表接口 `query/display/mall/goodsList` 抓的 `outSkuSn`/规格文案即可）。

## 红线

* 只读探测随便看；**写入（改规格名/提交）属于批量改写 → 需主管/经理明确确认**；先改 1 个商品试、再批量。
* 遇到滑块/验证码 → 停手叫人。
