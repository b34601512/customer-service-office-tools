const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");

function createFakeChildProcess(pid = 32001) {
  // 这里构造最小子进程桩，专门验证任务服务的退出收口行为。
  const child = new EventEmitter();
  child.pid = pid;
  child.stdinWrites = [];
  child.stdin = {
    write(content) {
      child.stdinWrites.push(content);
    }
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function loadTaskServiceWithMocks(spawnImpl, options = {}) {
  // 这里按测试注入假的 spawn 和依赖安装器，避免单元测试真的拉起生产进程。
  const childProcessModulePath = require.resolve("child_process");
  const ensureProjectDependenciesModulePath = require.resolve(
    "../../src/controlCenter/ensureProjectDependencies"
  );
  const processTreeModulePath = require.resolve("../../src/controlCenter/processTree");
  const taskServiceModulePath = require.resolve("../../src/controlCenter/controlCenterTaskService");
  const childProcessModule = require("child_process");
  const originalSpawn = childProcessModule.spawn;
  const originalEnsureProjectDependenciesCache = require.cache[ensureProjectDependenciesModulePath];
  const originalProcessTreeCache = require.cache[processTreeModulePath];
  const originalTaskServiceCache = require.cache[taskServiceModulePath];

  childProcessModule.spawn = spawnImpl;
  require.cache[ensureProjectDependenciesModulePath] = {
    id: ensureProjectDependenciesModulePath,
    filename: ensureProjectDependenciesModulePath,
    loaded: true,
    exports: {
      async ensureProjectDependencies() {}
    }
  };
  require.cache[processTreeModulePath] = {
    id: processTreeModulePath,
    filename: processTreeModulePath,
    loaded: true,
    exports: {
      async killProcessTree(pid) {
        if (typeof options.killProcessTree === "function") {
          await options.killProcessTree(pid);
        }
      }
    }
  };
  delete require.cache[taskServiceModulePath];

  const { ControlCenterTaskService } = require("../../src/controlCenter/controlCenterTaskService");

  return {
    ControlCenterTaskService,
    restore() {
      childProcessModule.spawn = originalSpawn;

      if (originalEnsureProjectDependenciesCache) {
        require.cache[ensureProjectDependenciesModulePath] = originalEnsureProjectDependenciesCache;
      } else {
        delete require.cache[ensureProjectDependenciesModulePath];
      }

      if (originalProcessTreeCache) {
        require.cache[processTreeModulePath] = originalProcessTreeCache;
      } else {
        delete require.cache[processTreeModulePath];
      }

      if (originalTaskServiceCache) {
        require.cache[taskServiceModulePath] = originalTaskServiceCache;
      } else {
        delete require.cache[taskServiceModulePath];
      }

      delete require.cache[childProcessModulePath];
    }
  };
}

test("后台任务异常退出后应该保留控制台状态并触发退出事件", async () => {
  const fakeChild = createFakeChildProcess();
  const { ControlCenterTaskService, restore } = loadTaskServiceWithMocks(() => fakeChild);
  const state = {
    currentTask: null,
    setTask(task) {
      this.currentTask = task;
    },
    appendLog() {}
  };
  const exitEvents = [];
  const service = new ControlCenterTaskService("E:\\Personal\\codex\\客服超时督办", state, {
    onTaskExit: (payload) => {
      exitEvents.push(payload);
    }
  });

  try {
    await service.startTask("start");
    fakeChild.emit("exit", 1, null);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(exitEvents.length, 1);
    assert.equal(exitEvents[0].taskName, "start");
    assert.equal(exitEvents[0].status, "failed");
    assert.match(exitEvents[0].exitMessage, /异常结束/);
    assert.equal(state.currentTask.status, "failed");
  } finally {
    restore();
  }
});

test("后台启动应该接管已发送完成确认但未退出的首次登录任务", async () => {
  const loginChild = createFakeChildProcess(41001);
  const startChild = createFakeChildProcess(41002);
  const children = [loginChild, startChild];
  const killedPids = [];
  const { ControlCenterTaskService, restore } = loadTaskServiceWithMocks(() => children.shift(), {
    async killProcessTree(pid) {
      killedPids.push(pid);
      loginChild.emit("exit", 0, null);
    }
  });
  const state = {
    currentTask: null,
    setTask(task) {
      this.currentTask = task;
    },
    appendLog() {}
  };
  const service = new ControlCenterTaskService("E:\\Personal\\codex\\客服超时督办", state);

  try {
    await service.startTask("login");
    service.handleProcessOutput("请在浏览器中完成登录，完成后回到这里按回车继续：", false);
    service.confirmLoginCompleted();

    assert.equal(state.currentTask.taskName, "login");
    assert.equal(state.currentTask.awaitingConfirmation, false);

    await service.startTask("start");

    assert.deepEqual(killedPids, [41001]);
    assert.equal(state.currentTask.taskName, "start");
    assert.equal(state.currentTask.status, "running");
    assert.equal(state.currentTask.pid, 41002);
  } finally {
    restore();
  }
});

test("后台启动不应该接管仍在等待确认的首次登录任务", async () => {
  const loginChild = createFakeChildProcess(42001);
  const { ControlCenterTaskService, restore } = loadTaskServiceWithMocks(() => loginChild);
  const state = {
    currentTask: null,
    setTask(task) {
      this.currentTask = task;
    },
    appendLog() {}
  };
  const service = new ControlCenterTaskService("E:\\Personal\\codex\\客服超时督办", state);

  try {
    await service.startTask("login");
    service.handleProcessOutput("请在浏览器中完成登录，完成后回到这里按回车继续：", false);

    await assert.rejects(
      () => service.startTask("start"),
      /首次登录还没完成，请先点击“完成登录”/
    );
    assert.equal(state.currentTask.taskName, "login");
    assert.equal(state.currentTask.awaitingConfirmation, true);
  } finally {
    restore();
  }
});

test("后台任务正常结束后应该回到空闲状态", async () => {
  const fakeChild = createFakeChildProcess();
  const { ControlCenterTaskService, restore } = loadTaskServiceWithMocks(() => fakeChild);
  const state = {
    currentTask: null,
    setTask(task) {
      this.currentTask = task;
    },
    appendLog() {}
  };
  const service = new ControlCenterTaskService("E:\\Personal\\codex\\客服超时督办", state);

  try {
    await service.startTask("start");
    fakeChild.emit("exit", 0, null);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.currentTask.status, "idle");
    assert.match(state.currentTask.message, /已结束/);
  } finally {
    restore();
  }
});

test("后台任务启动失败时应该直接暴露启动异常", async () => {
  const { ControlCenterTaskService, restore } = loadTaskServiceWithMocks(() => {
    throw new Error("子进程创建失败");
  });
  const state = {
    currentTask: null,
    setTask(task) {
      this.currentTask = task;
    },
    appendLog() {}
  };
  const service = new ControlCenterTaskService("E:\\Personal\\codex\\客服超时督办", state);

  try {
    await assert.rejects(() => service.startTask("start"), /子进程创建失败/);
    assert.equal(state.currentTask, null);
  } finally {
    restore();
  }
});

test("后台启动进入登录确认阶段后应该允许网页按钮继续执行", async () => {
  const fakeChild = createFakeChildProcess();
  const { ControlCenterTaskService, restore } = loadTaskServiceWithMocks(() => fakeChild);
  const state = {
    currentTask: null,
    setTask(task) {
      this.currentTask = task;
    },
    appendLog() {}
  };
  const service = new ControlCenterTaskService("E:\\Personal\\codex\\客服超时督办", state);

  try {
    await service.startTask("start");
    service.handleProcessOutput("请在浏览器中完成登录，完成后回到这里按回车继续：", false);

    assert.equal(state.currentTask.awaitingConfirmation, true);

    service.confirmLoginCompleted();

    assert.deepEqual(fakeChild.stdinWrites, ["\n"]);
    assert.equal(state.currentTask.awaitingConfirmation, false);
    assert.match(state.currentTask.message, /继续后台督办/);
  } finally {
    restore();
  }
});

test("控制台父进程应该识别子进程已经写过的结构化日志", () => {
  const { isStructuredChildLogLine } = require("../../src/controlCenter/controlCenterTaskService");

  assert.equal(
    isStructuredChildLogLine(
      "[2026-06-25 09:54:21.750][transferApiClient.js:211][主线:执行][未实质回复监控][读取消息事件] 会话=abc"
    ),
    true
  );
  assert.equal(isStructuredChildLogLine("请在浏览器中完成登录，完成后回到这里按回车继续："), false);
});

test("控制台父进程转发子进程错误日志时不应该写入宿主 stderr", () => {
  const { ControlCenterTaskService } = require("../../src/controlCenter/controlCenterTaskService");
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const stdoutLines = [];
  const stderrLines = [];
  const state = {
    currentTask: null,
    setTask() {},
    appendLog() {}
  };
  const service = new ControlCenterTaskService("E:\\Personal\\codex\\客服超时督办", state);
  const structuredErrorLine =
    "[2026-06-25 09:54:21.750][main.js:1][主线:失败][后台督办][单轮扫描失败] TypeError: fetch failed";

  console.log = (line) => {
    stdoutLines.push(line);
  };
  console.error = (line) => {
    stderrLines.push(line);
  };

  try {
    service.handleProcessOutput(structuredErrorLine, true);

    assert.deepEqual(stdoutLines, [structuredErrorLine]);
    assert.deepEqual(stderrLines, []);
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }
});
