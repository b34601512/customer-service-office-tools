const test = require("node:test");
const assert = require("node:assert/strict");
const { ControlCenterState } = require("../../src/controlCenter/controlCenterState");

// 测试用假输出流，避免 TUI 渲染把终端帧写进测试输出（node --test 并行运行文件，不能改全局 stdout）。
function createMockOutput() {
  return {
    writes: [],
    columns: 100,
    rows: 28,
    write(chunk) {
      this.writes.push(String(chunk));
    },
    on() {},
    removeListener() {}
  };
}

function buildMockRuntime() {
  const state = new ControlCenterState();
  state.setTask({
    taskName: "start",
    label: "后台督办",
    status: "running",
    startedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    pid: 4242,
    message: "后台督办运行中",
    awaitingConfirmation: false
  });
  state.appendLog("[2026-08-15 09:00:00.000][workflowRunner.js:1][主线:执行][聊天监控][读取分配快照] 联系人=20");
  state.appendLog("[2026-08-15 09:00:05.000][missedReplyNotifier.js:1][主线:完成][未实质回复监控][发送提醒] 客户=张三");
  state.appendLog("[2026-08-15 09:00:10.000][wecomRobot.js:1][主线:失败][企微机器人][发送失败] 网络超时");

  return {
    state,
    taskService: {
      startTask: async () => {},
      stopCurrentTask: async () => {},
      confirmLoginCompleted: () => {}
    },
    shutdown: () => {},
    getResourceRootPids: () => [process.pid],
    serverPort: 39360
  };
}

test("冒烟：七个页面都应该能无异常渲染出完整帧", () => {
  const { createTui } = require("../../src/controlCenter/tui/startTui");
  const runtime = buildMockRuntime();
  runtime.output = createMockOutput();
  const { app, dispose } = createTui(runtime);
  app.running = true;
  const pageTitles = ["总览", "客户", "日志", "配置", "企微", "资源", "报表"];

  for (let index = 0; index < 7; index += 1) {
    app.switchPage(index);
    const frame = app.buildFrame();
    assert.ok(Array.isArray(frame), `页面 ${pageTitles[index]} 应返回帧数组`);
    assert.ok(frame.length >= 9, `页面 ${pageTitles[index]} 帧应至少 9 行`);
    assert.ok(frame[0].includes("客服督办控制台"));
    assert.ok(frame.some((line) => line.includes(pageTitles[index])));
  }
  dispose();
});

test("冒烟：日志页应该展示结构化日志并能按关键字过滤", () => {
  const { createTui } = require("../../src/controlCenter/tui/startTui");
  const runtime = buildMockRuntime();
  runtime.output = createMockOutput();
  const { app, dispose } = createTui(runtime);
  app.running = true;
  app.switchPage(2);
  const logsPage = app.page;
  assert.ok(logsPage.state.lines.length >= 3);

  // 开启过滤
  logsPage.handleKey("/", app);
  "失败".split("").forEach((char) => logsPage.handleKey(char, app));
  logsPage.handleKey("enter", app);
  const visibleLines = logsPage.getVisibleLines();
  assert.ok(visibleLines.every((line) => line.includes("失败")));

  // 取消过滤
  logsPage.handleKey("/", app);
  logsPage.handleKey("esc", app);
  assert.equal(logsPage.state.filterText, "失败");
  dispose();
});

test("冒烟：登录确认横幅出现时回车应该触发确认回调", () => {
  const { createTui } = require("../../src/controlCenter/tui/startTui");
  const runtime = buildMockRuntime();
  runtime.output = createMockOutput();
  let confirmed = false;
  runtime.taskService.confirmLoginCompleted = () => {
    confirmed = true;
  };
  runtime.state.setTask({
    taskName: "login",
    label: "首次登录",
    status: "running",
    startedAt: new Date().toISOString(),
    pid: 5555,
    message: "等待登录确认",
    awaitingConfirmation: true
  });

  const { app, dispose } = createTui(runtime);
  app.running = true;
  app.buildFrame(); // 触发 statusBarProvider 更新 needsLoginConfirm
  assert.equal(app.needsLoginConfirm, true);
  app.dispatchKey("enter");
  assert.equal(confirmed, true);
  dispose();
});

test("冒烟：Ctrl+C 应该先进入退出确认再触发退出", () => {
  const { createTui } = require("../../src/controlCenter/tui/startTui");
  const runtime = buildMockRuntime();
  runtime.output = createMockOutput();
  let exitRequested = false;
  runtime.shutdown = () => {
    exitRequested = true;
  };

  const { app, dispose } = createTui(runtime);
  app.running = true;
  app.dispatchKey("ctrl-c");
  assert.equal(app.exitConfirmPending, true);
  app.dispatchKey("y");
  assert.equal(exitRequested, true);
  dispose();
});
