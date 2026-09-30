# 26号 后台申诉（拼多多维权申诉）

## 这个项目干什么

平台介入退款/判商家责任后，商家可以在**售后申诉**里提交凭证翻案：追回货款 + 撤销纠纷退款率。
本项目把 2026-09-28 首次实操（订单 `260923-***********2914`，少件争议退款¥150）的全流程固化下来：

```
① 找可申诉单       pdd-appeal-list.js        → 维权/赔偿/极速退款/极速换货 四类清单 + 金额/原因/倒计时
② 抓证据           pdd-appeal-context.js     → 售后单/订单详情/订单快照/售后聊天（含图片）一次抓齐
③ 写申诉文案       （人工/AI，≤300 字！）     → runtime/appeal/<订单号>/申诉文案.txt
④ 填表/提交        pdd-appeal-submit.js      → 默认 dry-run 只填不交；加 --submit 才真实提交
⑤ 查结果           pdd-appeal-list.js --records → 申诉记录里的审核状态（待处理/成功/失败/可复议）
```

## ⚠ 红线（用户 2026-09-28 拍板）

- **真实提交必须用户先批准**：`pdd-appeal-submit.js` 默认只填不交，`--submit` 是唯一提交开关。
- 滑块/验证码/短信验证 → 停下来叫人，不自动过。
- 失败后不自动重试平台请求；先查原因（见根目录 `失败台账.md` 纪律）。
- 本工具只读部分（①②⑤）可以随时跑；写操作只有「提交申诉」这一个动作。

## 怎么跑

```bash
cd "D:/桌面/办公软件/26.后台申诉"

# ① 采集可申诉清单（只读）
node src/tools/pdd-appeal-list.js --store pdd02
node src/tools/pdd-appeal-list.js --store pdd02 --out runtime/pdd/申诉清单-pdd02.json

# ② 一单取证（只读）：售后单 + 订单详情 + 订单快照 + 售后聊天（图片落 chat-imgs/）
node src/tools/pdd-appeal-context.js --store pdd02 --order 260923-***********2914
#   → runtime/appeal/<订单号>/{afterSales.json, 订单详情.txt, 订单快照.txt, 售后详情-*.txt, chat-imgs/, context.json}

# ③ 写文案（≤300 字，平台硬限制），存 runtime/appeal/<订单号>/申诉文案.txt

# ④ dry-run：只填不交，留页面人工核对（不碰「提交申诉」）
node src/tools/pdd-appeal-submit.js --store pdd02 --order <订单号> \
  --reason "消费者反馈商品空包/少件/漏件，但实际未少发" --amount 150 \
  --text-file runtime/appeal/<订单号>/申诉文案.txt \
  --required 订单快照.png 规格图A.png 规格图B.png --optional 赠品卡.png 聊天记录.png

# ⑤ 用户批准后，真实提交（不可修改！）
node src/tools/pdd-appeal-submit.js ...(同上) --submit --close-after

# ⑥ 查审核结果（只读）
node src/tools/pdd-appeal-list.js --store pdd02 --records --days 30

# 自检
node --test
```

## 关键口径 / 坑（详见 `经验/拼多多后台申诉-提交与举证.md`）

- **描述 ≤300 字**：超了 `POST /mercury/appeal/apply` 返回 `描述不能超过300字(3000000)`，第一次 434 字就是这么失败的
  （已被 `tests/appealRules.test.js` 锁死）。
- **上传图片别传错 input**：MMS 申诉弹窗在 DOM 里存在**两份隐藏副本**，给隐藏副本的 file input 传文件
  页面计数仍是 `(0/3)`；必须从**可见的「上传图片」文案**爬到它自己的 input（工具已封装）。
- **申诉项默认两个都勾**：货款申诉（追钱）+ 纠纷退款率申诉（免计纠纷率，不涉及钱款）。
- **申诉原因必须精确选平台选项**（7 个，见 `src/lib/appealRules.js`），不能自造文案。
- **凭证要有「指定规格」这类反证**：光有订单快照不够，要把买家截图里的小字（如赠品卡「指定规格 收货后晒图送」）
  和客服聊天（「血氧仪是指定规格」「您规格是没有的」）一起交，才能说明买家诉求不成立。
- **申诉入口 30 天内有效**（清单里每单自带倒计时），失败不罚、本月可复议（页面有 `0/12` 复议权益）。

## 本项目与 24号 的关系

- 24号《平台退款复查》是**找风险 → 判要不要申诉**；本项目负责**申诉实操（填表/提交/举证）**。
- 两边的 `pdd-appeal-list.js` 是同一份工具的两次落地：24号 那份继续服务它的复查编排，本项目这份
  多了 `--records`（查申诉记录）。改工具时两边都要看一眼（或以后统一到本项目，24号 引用这里）。
- 浏览器登录态/端口与 24号 **共用**：`pdd02=9445`、`pdd03=9446` → **同一家店不能同时开两个项目**。

## 目录

- `src/tools/`：`pdd-login.js`（登录态）、`pdd-appeal-list.js`（清单/记录）、
  `pdd-appeal-context.js`（取证）、`pdd-appeal-submit.js`（填表/提交）
- `src/lib/appealRules.js`：描述/金额/凭证/申诉项纯规则（被 `tests/` 锁死）
- `src/engine/`（浏览器、日志）、`src/config/stores.js`（店铺/端口/profile）
- `project-config/stores.json`（不入库；从 24号 拷来，同机接手直接用）
- `经验/拼多多后台申诉-提交与举证.md`（全流程+踩坑+案例实录）
