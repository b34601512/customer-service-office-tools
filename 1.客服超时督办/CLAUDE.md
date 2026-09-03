# 项目说明

## 1. 项目目标

这是给客服主管使用的本地督办工具。它登录小蟹客服工作台后，持续检查客户是否长期没有得到人工实质回复、是否发生客服转接、该上班时段是否无人在线，并在非上班时间按排班自动关闭「自动分配/可被转接」，避免客户转给未到岗客服后无人回复；需要提醒时发送到对应企微群，处理记录和绩效事实留在本地。

## 2. 技术形态

- Windows 本地 Node.js 命令行程序，采用 CommonJS，建议 Node.js 18 以上。
- 用 `playwright-core` 驱动独立 Chrome；控制中心由 Node.js 自带 HTTP 服务和原生 HTML/CSS/JavaScript 组成。
- 配置使用 JSON 和 JavaScript 文件，状态、日志、浏览器资料及绩效账本放在 `runtime/`。

## 3. 模块结构

- `src/main.js`：登录与后台督办总入口，同时启动共享聊天、无人在线和下班监控流程。
- `src/controlCenter/`：本地控制台（TUI 终端界面为主，Web 网页界面为可选）、配置保存、任务子进程、资源监控和安全退出。
- `src/controlCenter/tui/`：零依赖 ANSI 终端界面，七个页面（总览/客户/日志/配置/企微/资源/报表），复用同一套状态与服务。
- `src/features/chatMonitorRuntime/`、`transferMonitor/`、`missedReplyMonitor/`：共用完整联系人和成员快照；未回复责任从首条未解决客户消息起算，只有人工实质回复或客户明确表示问题已解决才能结案；客户弱收尾不关闭已有待办，AI 不参与结案。
- `src/features/shared/currentAssignment.js`：当前接待业务真源，第一依据仍是联系人接口 `assignedTo`；`assignedTo` 清空（如客服结束会话）时，按会话内最后一条人工消息发送人兜底归属为“最后接待客服”（last_handler，见 issue #621），兜不到成员映射才报未分配；渠道账号和历史操作人仍不得补定当前责任。
- `src/features/onlinePresenceMonitor/`、`offDutyClose/`、`scheduleQuery/`：读取金山排班，检查上班监控（该到班时无人在线提醒）并处理下班监控；下班链路启动后立即检查，默认每 5 分钟复查今天和昨天。
- `src/features/timeoutPerformance/`：记录企微群发送成功后的首次超时事实，并为 TUI 生成近 30 天或自然月对比。
- `src/features/supervision/`：保存最近过程记录，供首页摘要和排障使用，不参与绩效统计。
- `src/integrations/`、`src/engine/`：企微机器人、浏览器、日志、进程和运行目录基础能力；`tests/` 是自动化测试。

## 4. 界面模式

- `startControlCenter.js` 按 `--tui` / `--web` 或终端是否为 TTY 决定界面：TUI 模式接管当前终端（备用屏幕 + 原始按键），Web 模式拉起独立浏览器窗口。
- TUI 与 Web 共用同一套 `ControlCenterState`、`ControlCenterTaskService` 和配置服务；TUI 的日志页直接订阅状态总线。
- TUI 模式下 `console.log/error` 会被临时屏蔽，日志仍写入 `runtime/current-run.log` 并进入状态总线。
- 状态 JSON（漏回复/无人在线/下班/登录态/过程记录）统一走 `src/engine/safeJson.js` 安全读取；绩效只读取追加式 `runtime/timeout-performance/ledger.jsonl`。

## 4. 数据流

`控制台读取配置` → `受控 Chrome 复用登录态` → `客服接口读取联系人、消息和成员状态`，同时按需读取金山排班 → 各规则判断是否需要提醒或交接 → 企微机器人通知客服/主管 → 结果写入 `runtime/` 状态、日志和事实账本 → 控制台展示最新客户、处理进度与 TUI 绩效对比。

## 5. 如何运行和测试

```powershell
npm ci
npm run panel   # 也可双击“启动中心.bat”
npm test
```

首次使用先在控制台完成登录和企微配置。排查时可分别运行 `npm run login`、`npm start` 和 `npm run schedule`；正常退出应使用控制台退出按钮，让受控浏览器和后台进程一起关闭。
