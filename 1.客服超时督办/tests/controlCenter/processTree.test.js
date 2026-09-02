const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("child_process");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");

function createTaskkillProcessResult(options = {}) {
  // 这里构造异步 taskkill 子进程，专门覆盖 Windows 退出竞态。
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  process.nextTick(() => {
    if (options.stdout) {
      child.stdout.write(options.stdout);
    }
    if (options.stderr) {
      child.stderr.write(options.stderr);
    }
    child.stdout.end();
    child.stderr.end();
    child.emit("exit", options.code ?? 0);
  });

  return child;
}

function loadProcessTreeWithMocks(spawnImpl, spawnSyncImpl) {
  // 这里在加载模块前替换系统进程调用，避免单元测试真的结束本机进程。
  const modulePath = require.resolve("../../src/controlCenter/processTree");
  const originalSpawn = childProcess.spawn;
  const originalSpawnSync = childProcess.spawnSync;
  const originalCache = require.cache[modulePath];

  childProcess.spawn = spawnImpl;
  childProcess.spawnSync = spawnSyncImpl;
  delete require.cache[modulePath];

  const processTree = require("../../src/controlCenter/processTree");

  return {
    processTree,
    restore() {
      childProcess.spawn = originalSpawn;
      childProcess.spawnSync = originalSpawnSync;
      if (originalCache) {
        require.cache[modulePath] = originalCache;
      } else {
        delete require.cache[modulePath];
      }
    }
  };
}

test("taskkill 失败但复核 PID 已不存在时不应该误报退出失败", async () => {
  const { processTree, restore } = loadProcessTreeWithMocks(
    () => createTaskkillProcessResult({
      code: 128,
      stderr: "错误: 没有此任务的实例正在运行。"
    }),
    () => ({
      status: 1,
      stdout: "",
      stderr: ""
    })
  );

  try {
    await assert.doesNotReject(() => processTree.killProcessTree(0));
  } finally {
    restore();
  }
});

test("taskkill 失败且 PID 仍存在时应该直接抛出真实错误", async () => {
  const { processTree, restore } = loadProcessTreeWithMocks(
    () => createTaskkillProcessResult({
      code: 5,
      stderr: "拒绝访问。"
    }),
    () => ({
      status: 0,
      stdout: "",
      stderr: ""
    })
  );

  try {
    await assert.rejects(() => processTree.killProcessTree(process.pid), /终止进程树失败：拒绝访问/);
  } finally {
    restore();
  }
});
