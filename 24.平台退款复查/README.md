# 24. 平台退款复查（天猫 / 拼多多 / 京东）

## 角色
AI 是**复查秘书**：只读检查「平台已给买家退款 / 可申诉」订单的**货物是否安全**，输出需要申诉或跟进的清单。
**不做**业务动作：不点同意、不提交申诉、不发消息（要动作先问用户）。

## 核心思想（用户 2026-09-27）
找到待申诉的订单，去看**我们的货物安不安全**——避免「平台给款退了，然后货发出了」「发出了没有退回」的双重损失。
判定顺序（一个订单依次看）：
1. **ERP 已作废** ⇒ 客服已取消、不会发货 ⇒ 货物安全（无需申诉）。
2. **ERP 已审单/打单** ⇒ 找仓库是否**撕单**；撕单不会发出 ⇒ 货物安全。
3. **ERP 已发货** ⇒ 查金山《2026年【湖南怀化售后】对接表》是否登记退货：
   - 已登记退回 ⇒ 货物安全；
   - 未登记退回 ⇒ **损失风险 ⇒ 要申诉/重点跟进**。
4. **京东仓退货表**（用户 2026-09-27 追加，对所有平台都查）⇒ 货退到京东仓也算安全：
   `wl.jdl.com` →「退货至京东库房管理」→ 导出明细（最近 3 个月）→ 命中「销售平台单号」即 **安全-已退京东仓**。
   （实测 453 行里有 136 个天猫单——京东仓不只发京东单。）

## 数据来源
| 用途 | 地址 | 读取方式 |
| --- | --- | --- |
| 天猫待申诉订单 | https://qn.taobao.com/home.htm/appeal/portal/appealable/D/1 | 受控浏览器（复用天猫 profile 登录态） |
| 拼多多可申诉订单 | https://mms.pinduoduo.com/orders/appeals/aftersale/order | 受控浏览器（同源 fetch 接口，见 `pdd-appeal-list.js`） |
| ERP 查单/作废/审单/发货 | https://v2.guanyierp.com/index | 受控浏览器（独立 ERP profile） |
| 售后对接表（退货登记） | https://www.kdocs.cn/l/<对接表分享ID> | AirScript 服务端只读（`kdocs-query.js`） |
| 撕单表 | https://www.kdocs.cn/l/<撕单表分享ID> | 网页只读整表（`read-kdocs.js`） |

## 红线
- 后台/ERP/金山一律**只读**；任何提交/申诉/同意/发送动作先停下来问用户。
- 登录、滑块、验证码、短信：停下来叫人；登录态存 profile，下次复用。
- 失败按根目录《失败处置总方针》：不自动重试、先记 `失败台账.md`，同一现象 ≥2 次才算规律。
- 不 `git add -A`；只提交自己改的文件。

## 目录
```
src/engine/     受控浏览器（browser.js）、日志（log.js）、金山只读（kdocs*.js）
src/tools/      可组合小工具（probe/dump/order extract/kdocs/ERP 等，单职责 CLI）
src/orderExtract/  7号 的订单号提取（文本 + xlsx）
经验/           实战经验（天猫后台采集、金山只读、报表口径、踩坑）
project-config/ 店铺清单 stores.json（不入库）、金山市令（不入库）
runtime/        运行产物（不入库）：浏览器 profile、探针输出、结果清单
```

## 常用命令
```bash
# 1) 采集待申诉清单（点 tab D/P/C/T + 自动翻页；产物 runtime/tmall/申诉清单-<店>-<时间>.json）
node src/tools/tmall-appeal-list.js --store tmall1 --tabs D,P,C,T
#    登录态失效时：node src/tools/tmall-login.js --store tmall1（账号密码运行时读 9号/12号；滑块叫人）

# 2) ERP 批量查状态（作废/审核/配货/发货；产物 runtime/erp/ERP状态-<时间>.json）
node src/tools/erp-order-status.js --orders-file runtime/tmall/订单号-tmall1.txt

# 3) 金山只读
node src/tools/read-kdocs.js --url "https://www.kdocs.cn/l/<撕单表分享ID>" --sheet "撕单表" --out runtime/kdocs/撕单表.json
node src/tools/kdocs-query.js <订单号...> --out runtime/kdocs/退货查询.json

# 4) 一条龙复查（清单→ERP→撕单表→退货登记→报告）
node scripts/复查天猫申诉订单.js --stores tmall1,tmall2,tmall6
node scripts/复查拼多多申诉订单.js --stores pdd02,pdd03
#    报告：runtime/review/复查报告-<平台>-<时间>.md

# 拼多多清单采集（四 tab：维权/赔偿/极速退款/极速换货；只读接口）
node src/tools/pdd-appeal-list.js --store pdd02
#    登录态失效时：node src/tools/pdd-login.js --store pdd02（自动填一次，无滑块）
```

## 判定口径（脚本结构判定 + 模型语义）
| 情况 | 判定 |
| --- | --- |
| ERP `cancel=true` | 安全-已作废 |
| ERP 已发货（`deliveryState>0`）且退货表搜到 | 安全-已登记退货 |
| ERP 已发货且退货表搜不到 | **风险-已发货未登记退货** |
| ERP 未发货但《撕单表》有记录 | 待读撕单状态（原文交模型语义读，不写关键词判） |
| ERP 已审核、未发货、撕单表没有 | 风险-已审单未撕单（可能还会发） |
| ERP 查无此单 | 待人工核 |

## 实测事实
- **天猫（2026-09-27，三店 23 个申诉单号）**：安全 22（已登记退货 20 / ERP已作废 1 / 平台备注「请勿发货」1）｜ 风险 1（`5127801625175058100`，已发企微提醒 @李四）。
- **拼多多（2026-09-27）**：pdd02 74 条 / pdd03 15 条（共 88 个唯一订单），全部「已发货」；复查结果见 `runtime/review/复查报告-pdd-*.md`。

## 能力来源（别重造）
- **22号**（后台售后服务单分析）：本项目的 `src/`、`经验/` 直接复刻，含受控浏览器、金山 AirScript、天猫/ERP 探针思路。
- **7号**（订单号提取）：`src/orderExtract/`（拼多多/天猫退款编号提取、xlsx 解析）。
- **4号**（仅退款自动提醒）：管易云 ERP 的 Playwright 实战（登录/订单查询页/全选导出/页面识别常量）。
