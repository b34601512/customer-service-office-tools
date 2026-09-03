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
- `src/features/workOrderMonitor/`：业务真源。
  - `textParser.js`：纯函数，页面文本 → 分类计数、登录跳转识别（fixture 来自实测文本）。
  - `alertPolicy.js`：纯函数判定，计数新增/登录失效(节流)/恢复/可选重复提醒 → 事件。
  - `messageText.js`：纯函数，事件 → 企微文案。
  - `pageProbe.js`：驱动浏览器读页面，输出观测值。
  - `service.js`：`monitorOnce()`（探测→判定→发送→落状态，单店失败隔离）、`startMonitorLoop()`。
  - `loginAssist.js`：拉起某店铺可见浏览器供人工登录一次。
- `src/cli/startCli.js`：唯一界面，只做参数解析与调用 service，零业务判断。
- `tests/`：node:test 纯函数测试（解析/判定/配置）。

## 5. 判定规则（唯一真源 alertPolicy.evaluateRound）

- 基线存在 `runtime/state/monitor-state.json`；某分类计数**上升**才提醒，回落/持平不打扰。
- 首轮非零计数提醒一次（`alertOnFirstRun`，默认开，让存量工单不被漏）。
- 登录失效立即提醒并按 `loginAlertThrottleMinutes` 节流，恢复登录提醒一次。
- `repeatReminderMinutes`>0 时未清零存量会周期性重复提醒（默认 0 关闭）。
- 提醒结果追加 `runtime/state/alert-ledger.jsonl`；发送失败回滚 lastAlertAt，下轮重试。

## 6. 运行方式

```powershell
npm install
# 1) 先为每个店铺完成一次登录（会打开浏览器，人工登录京麦后回车关闭）
node src/cli/startCli.js login jingxi1
# 2) 巡检一轮（--dry-run 只演练不发消息）
node src/cli/startCli.js once --dry-run
# 3) 常驻监控（Ctrl+C 退出）/ 交互菜单 / 链路自测
node src/cli/startCli.js run
node src/cli/startCli.js menu
node src/cli/startCli.js test-notify
npm test
```

## 7. 配置说明

`project-config/platform-config.json`：
- `wecom.webhookUrl` 企微群机器人地址；`monitor.*` 间隔/超时/节流等。
- `platforms.jd.stores[]`：`key`（同时决定 profile 目录 `runtime/state/browser-profiles/jd/<key>`）、`displayName`、`username`（登录辅助提示）、`enabled`、`mentionedMobileList`（@客服）。
- `sources[]`：`type` 目前支持 `jingxiWorkOrder` / `popDispute`（未来平台=新 type+新页面文本规则），`url`，`watch`（要监控的页签分类名）。
