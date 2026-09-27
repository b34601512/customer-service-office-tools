# 管易云 ERP 查单：批量查订单状态（2026-09-27 实测）

## 一、入口与登录
- 地址：`https://v2.guanyierp.com/index`（登录页 `login.guanyierp.com`）
- 本项目 profile：`runtime/state/browser-profiles/erp/default`（端口 9444，从 4号 拷来的登录态）
- 登录态失效时：拉起窗口由**用户人工登录**（用户 2026-09-27 已登录一次），登录后长期复用。
- 订单查询页是**主页面里的一个 frame**，URL 含 `trade_order_header`（实测 frame[2]）。
  首页菜单里点「订单查询」进入。

## 二、查询接口（已逆向明白，别再猜）
- `POST https://v2.guanyierp.com/tc/trade/trade_order_header/data/list`
  `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`
- 返回：`{ total, rows:[{...每单 100+ 字段...}] }`，`rows` 里字段齐全（不用读表格 DOM）。
- 在页面 frame 里直接 `fetch` 即可（同源带 cookie，无需额外 token/CSRF 头）：
  ```js
  await frame.evaluate((body) => fetch("/tc/trade/trade_order_header/data/list", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body
  }).then((r) => r.json()), payload);
  ```

## 三、批量单号编码（关键，实测）
- 页面「平台单号」输入框旁的 `...` 按钮打开「批量筛选」对话框：选分隔符（空格/分号/逗号/换行）→ 贴单号。
- 前端 JS 真源码（gycomponents 包）：
  ```js
  b = [{value:1,text:"空格"},{value:2,text:"分号"},{value:3,text:"逗号"},{value:4,text:"换行"}]
  // 提交时把分隔符替换成字面量 "(enter)"
  ```
- 所以接口参数是：
  `platformCode=单号1(enter)单号2(enter)…&separatorPlatform=3`（3=逗号；1=空格、2=分号、4=换行）
- **坑**：`separatorPlatform=1` 配逗号分隔 = 0 命中（我踩过）；必须是 3。
- 单批最多 200 条（对话框提示，超过只查前 200）。

## 四、日期过滤 dateType（必须查两遍）
- 页面「单据时间」只有 3 个选项（实测请求值）：
  `0=最近7天`、`1=2017年至7天以前`、`2=2017年以前`
- 订单可能落在任一段 → 本工具对每批单号自动查 `dateType=0/1/2` 三遍再合并（按 platformCode 去重）。
- 不传 dateType 时服务端会套默认过滤（实测会漏老单）。

## 四之二、作废过滤 cancel（必看，2026-09-27 用户实测踩坑）
- 左侧筛选面板底部有一排勾选框：发票 / 退款 / 审核 / 财审驳回 / **作废** / 拦截；
  勾上=**只看这一类**，不勾=该类不过滤。
- 接口参数 `cancel` 语义（实测三组对照）：
  | 传值 | 含义 | 结果 |
  | --- | --- | --- |
  | `cancel=false` | 只看**未**作废 | 作废单 0 命中（**默认坑**）|
  | `cancel=true` | 只看作废 | 未作废单 0 命中 |
  | `cancel=`（留空）| **不过滤，作废+未作废都返回** | 两种单都能查到 |
- 实测案例：`5127668712759105946`（天猫1 申诉单）在 ERP 里是**作废单**，
  最初工具传 `cancel=false` 查不到，被误判「ERP无此单」；
  用户在页面上勾了「作废」才看到（ERP 单号 SO1017580326528，已作废/未审核/未发货/卖家备注 88）。
- **本工具固定传 `cancel=`（空）**，一次拿全。

## 五、状态字段语义（判"作废/审单/发货"）
| 字段 | 含义 |
| --- | --- |
| `cancel` | true=已作废（不会发货 → 安全） |
| `approve` | true=已审核（审单） |
| `assignState` | 0=未配货、1=部分配货、2=全部配货 |
| `deliveryState` | 0=未发货、1=部分发货、2=全部发货 |
| `refund` | 退款标记（1=有退款） |
| `financeReject` | 财审驳回 |
| `expressName` / `mailNo` | 快递公司 / 快递单号 |
| `sellerMemo` | 卖家备注（客服标记） |
| `sysTradingStateDesc` / `platformTradingStateDesc` | 交易状态（如"交易关闭"） |
| `createDate` | ERP 建单时间 |

## 六、实测结果（2026-09-27，23 个申诉单号）
- 21 单命中 ERP、2 单 ERP 无此单（都是"仅退款"）。
- 21 单全部「未作废/已审核/全部配货/全部发货」。
- 命令：`node src/tools/erp-order-status.js --orders-file <单号文件> --out runtime/erp/状态.json`

## 七、踩坑记录
1. 用 Git Bash 跑 robocopy 时 `/E` 会被 MSYS 当路径转换 → 用 `cp -r` 或 `//E`。
2. 探测期间页面留下过 login 标签页，无害；但工具每次会新开页、用完关闭。
3. 不要用 `page.goto` 反复刷 ERP 订单页（SPA）；frame 一直在就复用。
4. **作废单必须显式查**：`cancel=false`（页面默认）会静默漏掉作废单，
   实测把「已作废」误判成「ERP无此单」→ 工具固定 `cancel=`（空）。（2026-09-27 用户发现）
