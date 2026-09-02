const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  BROWSER_MISSING_CHECK_LIMIT,
  CLEANUP_WATCHDOG_WORKER_FLAG,
  GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  buildCleanupWatchdogArguments,
  checkCleanupWatchdogOnce,
  createCleanupWatchdogState,
  parseCleanupWatchdogArguments,
  startControlCenterCleanupWatchdog
} = require("../../src/controlCenter/controlCenterCleanupWatchdog");

test("清理看门狗应该以普通参数启动独立 Node 文件", () => {
  const argumentsList = buildCleanupWatchdogArguments({
    parentPid: 100,
    controlBrowserPid: 200,
    serverPort: 39360
  });
  const config = parseCleanupWatchdogArguments(argumentsList);

  assert.equal(argumentsList[0], CLEANUP_WATCHDOG_WORKER_FLAG);
  assert.deepEqual(config, {
    parentPid: 100,
    controlBrowserPid: 200,
    serverPort: 39360
  });
});

test("清理看门狗启动器不应该调用脚本宿主或命令解释器", () => {
  let receivedCommand = "";
  let receivedArguments = [];
  let receivedOptions = null;
  let unrefCalled = false;
  const fakeWorker = {
    pid: 300,
    once() {},
    unref() {
      unrefCalled = true;
    }
  };

  const workerPid = startControlCenterCleanupWatchdog({
    parentPid: 100,
    controlBrowserPid: 200,
    serverPort: 39360
  }, {
    spawnProcess(command, args, options) {
      receivedCommand = command;
      receivedArguments = args;
      receivedOptions = options;
      return fakeWorker;
    }
  });

  assert.equal(workerPid, 300);
  assert.equal(receivedCommand, process.execPath);
  assert.match(receivedArguments[0], /controlCenterCleanupWatchdog\.js$/);
  assert.equal(receivedArguments.includes(CLEANUP_WATCHDOG_WORKER_FLAG), true);
  assert.equal(receivedOptions.detached, true);
  assert.equal(receivedOptions.windowsHide, true);
  assert.equal(unrefCalled, true);
});

test("清理看门狗源码不应包含旧脚本执行与全进程扫描方式", () => {
  const source = fs.readFileSync(require.resolve("../../src/controlCenter/controlCenterCleanupWatchdog"), "utf8");

  assert.doesNotMatch(source, new RegExp("power" + "shell", "i"));
  assert.doesNotMatch(source, new RegExp("encoded" + "command", "i"));
  assert.doesNotMatch(source, new RegExp("win32" + "_process", "i"));
  assert.doesNotMatch(source, new RegExp("get-" + "ciminstance", "i"));
});

test("宿主异常退出后只清理最近确认的任务和受控浏览器", async () => {
  const config = {
    parentPid: 100,
    controlBrowserPid: 200,
    serverPort: 39360
  };
  const state = createCleanupWatchdogState();
  state.taskPid = 300;
  state.taskPidObservedAt = 1000;
  const killedPids = [];

  const shouldContinue = await checkCleanupWatchdogOnce(config, state, {
    now: () => 1001,
    processExistsByPid: (pid) => pid !== config.parentPid,
    killProcessTree: async (pid) => killedPids.push(pid)
  });

  assert.equal(shouldContinue, false);
  assert.deepEqual(killedPids, [300, 200]);
});

test("TUI 模式只同步当前任务，不应该触发窗口退出", async () => {
  const config = {
    parentPid: 100,
    controlBrowserPid: 0,
    serverPort: 39360
  };
  const state = createCleanupWatchdogState();
  let shutdownRequests = 0;

  const shouldContinue = await checkCleanupWatchdogOnce(config, state, {
    now: () => 1000,
    processExistsByPid: () => true,
    readState: async () => ({ parentPid: 100, taskPid: 300 }),
    requestShutdown: async () => {
      shutdownRequests += 1;
    }
  });

  assert.equal(shouldContinue, true);
  assert.equal(state.taskPid, 300);
  assert.equal(shutdownRequests, 0);
});

test("网页窗口消失时先请求正常退出，超时后才精确清理", async () => {
  const config = {
    parentPid: 100,
    controlBrowserPid: 200,
    serverPort: 39360
  };
  const state = createCleanupWatchdogState();
  let now = 1000;
  let shutdownRequests = 0;
  const terminatedParents = [];
  const killedPids = [];
  const dependencies = {
    now: () => now,
    processExistsByPid: (pid) => pid === config.parentPid || pid === state.taskPid,
    readState: async () => ({ parentPid: 100, taskPid: 300 }),
    requestShutdown: async () => {
      shutdownRequests += 1;
    },
    terminateParent: (pid) => terminatedParents.push(pid),
    killProcessTree: async (pid) => killedPids.push(pid)
  };

  for (let index = 0; index < BROWSER_MISSING_CHECK_LIMIT; index += 1) {
    await checkCleanupWatchdogOnce(config, state, dependencies);
  }
  assert.equal(shutdownRequests, 1);
  assert.deepEqual(terminatedParents, []);
  assert.deepEqual(killedPids, []);

  now += GRACEFUL_SHUTDOWN_TIMEOUT_MS - 1;
  assert.equal(await checkCleanupWatchdogOnce(config, state, dependencies), true);
  assert.deepEqual(terminatedParents, []);

  now += 1;
  assert.equal(await checkCleanupWatchdogOnce(config, state, dependencies), false);
  assert.deepEqual(terminatedParents, [100]);
  assert.deepEqual(killedPids, [300]);
});
