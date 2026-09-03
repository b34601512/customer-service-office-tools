# 项目说明（14号：后台工单自动提醒）

## 1. 项目目标

后台系统出现需要客服处理的工单时（先做京东：京喜店「任务工单」+ POP店「交易纠纷」，未来扩展天猫/拼多多/抖音），自动向企业微信群机器人发提醒。支持多店铺、每店铺独立浏览器登录态；登录失效也要提醒并有节流。

## 2. 关键事实（为什么这样做，依据 #623 采集）

- 京东两类页面数据接口都走 `sff.jd.com` DSM 网关，且必须带页面 SDK 生成的 `h5st`+`dsm-eid` 签名；外部 Node 直连复放实测返回 312，**不做逆向**。
- 因此取数方案 = 复用 9 号项目的「按店铺 profile + 受控 Chrome（remote-debugging-port + playwright-core connectOverCDP）」打开真实页面，**读页面 DOM 文本里的页签计数**，如「平台协同工单 (0)」「待处理(0)」「可申诉(1)」。
- 两类页面页签名即分类真源；`runtime/probe/out/` 保留实测页面文本与接口参数快照。

## 3. 技术形态

- Windows 本地 Node.js 18+ 命令行工具，CommonJS。
- 依赖仅 `playwright-core`；企微发送用原生 fetch（照 1 号 `wecomRobot.js`）。
- 配置 `project-config/platform-config.json`（不入库，模板 example）；登录态、状态、日志在 `runtime/`（不入库）。

## 4. 模块结构（UI 与业务分离，遵循 SoftTalk#2705）

- `src/config/appConfig.js`：路径与常量。
- `src/config/projectConfigService.js`：配置加载/校验/遍历真源。
- `src/engine/`：`chromeSession.js`（按店铺 profile 拉起/连接/关闭受控 Chrome）、`logger.js`、`fileSystem.js`。
- `src/integrations/wecomRobot.js`：企微 text 消息发送（超时 10s、重试 1 次）。
- `src/features/dutySchedule/`：值班@业务真源（照搬 1 号匿名读金山排班表，增强读底色）。
  - `dutyParser.js`：纯函数，矩阵+色格 → 当日售后班次/底色 + 按天@规则 selectAtStaff（组长在班/标记色）+ 色名描述。
  - `scheduleFetcher.js`：无头 Chrome 打开排班表，矩阵 + 当日格 `getAppliedXf` 底色（实测 getXfByCell 读不到条件格式色，必须 getAppliedXf）。
  - `dutyService.js`：`resolveDuty()`（按天缓存）+ `buildMentionPlan()`（@名单=组长在班+标记色售后+主管；读失败降级只@主管）。
- `src/features/workOrderMonitor/`：业务真源。
  - `textParser.js`：纯函数，页面文本 → 分类计数、登录跳转识别、表格行→工单（订单号/纠纷状态/去申诉标记；状态文案实测是“纠纷单关闭”带单字）。
  - `alertPolicy.js`：纯函数判定，计数新增（附新单订单号）/待商家处理重发/去申诉只一次/登录失效(节流)/恢复/可选重复提醒 → 事件。
  - `messageText.js`：纯函数，事件+值班@计划 → 企微文案数组，**一单一消息**。最少必要：店铺缩写（自带平台信息，不加“京东·”前缀）+分类事项+订单号；不发链接/时间（企微自带）/纠纷单号/判责字样；群里值班信息只有「本次@：姓名（原因）」一行，完整班次/底色表在 CLI duty 命令看。
  - `pageProbe.js`：驱动浏览器读页面；计数稳定后对非零页签**深读表格行**（POP 用 tabCode URL 直跳，京喜点页签），输出 计数+ticketsByLabel；行解析靠操作按钮/编号形态过滤噪声（实测客服电话 4006229068 会伪装成单）。
  - `service.js`：`monitorOnce()`（探测→判定→发送→落状态，单店失败隔离）、`startMonitorLoop()`。
  - `loginAssist.js`：拉起某店铺可见浏览器供人工登录一次。
- `src/cli/startCli.js`：唯一界面，只做参数解析与调用 service，零业务判断。
- `tests/`：node:test 纯函数测试（解析/判定/配置）。

## 5. 判定规则（唯一真源 alertPolicy.evaluateRound）

- 基线存在 `runtime/state/monitor-state.json`；某分类计数**上升**才提醒（附新增单订单号），回落/持平不打扰。
- 首轮非零计数提醒一次（`alertOnFirstRun`，默认开，让存量工单不被漏）。
- 登录失效立即提醒并按 `loginAlertThrottleMinutes` 节流，恢复登录提醒一次。
- `repeatReminderMinutes`>0 时未清零存量会周期性重复提醒（默认 0 关闭）。待商家处理重发不受此限制，另走 merchantPendingRepeatMinutes。
- 纠纷状态驱动（用户 2026-09-03 定：**不看判责看状态**，实测判责列会把已关闭单误当未判责刷屏）：待商家处理/待商家回复→每 `monitor.merchantPendingRepeatMinutes`（默认30，0=关）重发；待客户确认（客服已处理）、纠纷单关闭等完结/非商家侧状态→不提醒；状态转完结→静默停发不补报；单子消失/清零→记录删除。
- 操作列含“去申诉”的单：只随新增提醒一次，永不重发（canAppeal 标记）。
- 一单一消息：发送层把事件拆成每订单一条，不在一条里堆多单（消息文本见 messageText 头注）。
- 提醒结果追加 `runtime/state/alert-ledger.jsonl`；发送失败回滚该源到本轮前快照，下轮重试。

## 5b. 值班@规则（唯一真源 dutySchedule，按天判定不看时刻）

- 组长（duty.leadNames，如李守耀）当日有班（早/晚）→ @他；他在就是他总值班，不按时段拆。
- 其他售后：只看格上**背景标记色**——当日有班且底色非空非白（白=#FFFFFF 在 nonMarkerColors 名单内不算标记）→ @；行政/年假/休息不@。
- 主管（duty.managerNames）永远@；@用 `mentioned_mobile_list`（手机号，memberMobileMap 真源在配置，与 1 号同源）。
- 群里只附一行「本次@：姓名（原因）」（原因=组长值班/色名底标记）；完整「今日售后值班（班次·底色）」表只用 `duty` 命令查看，不进群（最少必要文案，用户 2026-09-03 定）。
- 底色真源=金山单元格 `getAppliedXf` 实心填充 rgb（getXfByCell 读不到条件格式色，实测推翻）；实测售后白底#FFFFFF/浅蓝#BDD7EE，休息黄底#FFFF00。色名表 duty.colorNames 可扩。
- 排班读取失败降级：照常发事件提醒，只@主管，文案注明失败原因；排班结果按天缓存，一天只拉一次浏览器。

## 6. 运行方式

```powershell
npm install
# 1) 先为每个店铺完成一次登录（会打开浏览器，人工登录京麦后回车关闭）
node src/cli/startCli.js login jd1
# 2) 巡检一轮（--dry-run 只演练不发消息）
node src/cli/startCli.js once --dry-run
# 3) 常驻监控（Ctrl+C 退出）/ 交互菜单 / 链路自测
node src/cli/startCli.js run
node src/cli/startCli.js menu
node src/cli/startCli.js test-notify
node src/cli/startCli.js duty    # 验证金山排班读取：今日售后班次/底色/当前在班/@名单
npm test
```

## 7. 配置说明

`project-config/platform-config.json`：
- `wecom.webhookUrl` 企微群机器人地址；`monitor.*` 间隔/超时/节流等。
- `platforms.jd.stores[]`：`key`（同时决定 profile 目录 `runtime/state/browser-profiles/jd/<key>`）、`displayName`、`username`（登录辅助提示）、`enabled`、`mentionedMobileList`（@客服）。
- `sources[]`：`type` 目前支持 `jingxiWorkOrder` / `popDispute`（未来平台=新 type+新页面文本规则），`url`，`watch`（要监控的页签分类名）。
- `wecom.memberMobileMap`：姓名→手机号（与 1 号 wecom-robot.json 同源）。
- `duty`（可选模块，配置了就必须完整，校验器强校验）：`scheduleUrl` 金山排班表、`group`（=售后）、`leadNames`（值班组长，须在 memberMobileMap 里有号）、`managerNames`（永远@的主管）、`nonMarkerColors`（不算标记的颜色，默认白）、`colorNames`（rgb→人话色名）。
