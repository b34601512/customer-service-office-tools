const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(relative, dependencies) {
  const filename = path.resolve(__dirname, "../../src", relative);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`未模拟依赖 ${name}`);
      return dependencies[name];
    }, module, console
  }, { filename });
  return module.exports;
}

test("业务运行无头、登录可见，且二者只使用独立 Edge 资料", async () => {
  const calls = [];
  const browser = load("engine/browser.js", {
    fs: { mkdirSync() {} },
    "playwright-core": { chromium: { async launchPersistentContext(dir, options) {
      calls.push({ dir, options });
      return { setDefaultTimeout() {} };
    } } },
    "../config/appConfig": { userDataDir: "isolated-edge", runHeadless: true },
    "../config/appRuntimeConfig": {}, "./logger": { log() {} },
    "./pageReadiness": {}, "./browserRuntimeGuard": { prepareBrowserRuntimeForLaunch() {} },
    "./browserExecutable": { resolveEdgePath: () => "msedge.exe" }
  });
  await browser.launchBrowser("run");
  await browser.launchBrowser("login");
  assert.equal(calls[0].options.headless, true);
  assert.equal(calls[1].options.headless, false);
  assert.equal(calls[0].dir, calls[1].dir);
  assert.ok(calls.every((call) => call.options.executablePath === "msedge.exe"));
});

test("无 Edge 时明确报错，不选择 Chrome", () => {
  const executable = load("engine/browserExecutable.js", {
    fs: { existsSync: () => false },
    "../config/appConfig": { edgePaths: ["missing/msedge.exe"] },
    "./logger": { log() {} }
  });
  assert.throws(() => executable.resolveEdgePath(), /未找到现代 Microsoft Edge/);
});

test("登录自检失败时不会启动任何工作流，并关闭浏览器", async () => {
  let started = 0;
  let closed = 0;
  let stopped = false;
  const initialPage = {};
  const noop = () => {};
  const main = load("main.js", {
    "./engine/browser": { launchBrowser: async () => ({ pages: () => [initialPage], close: async () => { closed++; } }), navigateToTargetPage: async () => {} },
    "./engine/logger": { log: noop },
    "./features/loginFlow": { ensureLoginReadyForRun: async () => { throw new Error("登录失效"); } },
    "./engine/stopSignal": { createStopState: () => ({ state: {}, dispose() { stopped = true; } }) },
    "./engine/runtimeMaintenance/runtimeMaintenance": { startRuntimeMaintenanceLoop: () => noop, runRuntimeMaintenanceOnce: noop },
    "./engine/browserCacheSanitizer": { collectBusinessBrowserDataDirs: () => [] },
    "./features/offDutyClose/offDutyWorkflow": { monitorOffDutyWorkflow() { started++; } },
    "./features/chatMonitorRuntime/workflowRunner": { monitorSharedChatWorkflow() { started++; } },
    "./features/onlinePresenceMonitor/onlinePresenceWorkflow": { monitorOnlinePresenceWorkflow() { started++; } },
    "./engine/browserRuntimeGuard": {}
  });
  await assert.rejects(main.runHeadlessMode(), /登录失效/);
  assert.equal(started, 0);
  assert.equal(closed, 1);
  assert.equal(stopped, true);
});
