const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const appConfig = require("../../src/config/appConfig");
const { createServer, resolveTaskStartRequest } = require("../../src/controlCenter/controlCenterServer");
const { markLoginStatusValid } = require("../../src/features/loginStatusStore");

async function withTempLoginStatusPath(callback) {
  // 这里隔离登录态文件，避免测试读写真实生产运行状态。
  const originalLoginStatusPath = appConfig.loginStatusPath;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "control-center-server-"));
  appConfig.loginStatusPath = path.join(tempRoot, "login-status.json");

  try {
    await callback(appConfig.loginStatusPath);
  } finally {
    appConfig.loginStatusPath = originalLoginStatusPath;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("登录态未验证时首次登录请求应该继续走登录任务", async () => {
  await withTempLoginStatusPath(async () => {
    const taskRequest = resolveTaskStartRequest("login");

    assert.equal(taskRequest.taskName, "login");
    assert.equal(taskRequest.message, "任务已启动。");
  });
});

test("登录态已验证有效时首次登录请求应该直接转成后台启动", async () => {
  await withTempLoginStatusPath(async (loginStatusPath) => {
    markLoginStatusValid(loginStatusPath, {
      targetUrl: "https://zan-mh.xiaoshunai.com/main/org/group/chat",
      source: "test",
      detail: "测试登录态有效。"
    });

    const taskRequest = resolveTaskStartRequest("login");

    assert.equal(taskRequest.taskName, "start");
    assert.equal(taskRequest.message, "当前登录态已验证有效，已直接启动后台督办。");
  });
});

test("后台启动请求不应该被登录态转换规则改写", async () => {
  await withTempLoginStatusPath(async (loginStatusPath) => {
    markLoginStatusValid(loginStatusPath, {
      targetUrl: "https://zan-mh.xiaoshunai.com/main/org/group/chat",
      source: "test",
      detail: "测试登录态有效。"
    });

    const taskRequest = resolveTaskStartRequest("start");

    assert.equal(taskRequest.taskName, "start");
    assert.equal(taskRequest.message, "任务已启动。");
  });
});

test("控制台服务应该返回专属督办图标资源", async () => {
  const server = createServer({
    port: 0,
    state: {
      eventBus: {
        on() {}
      },
      getSnapshot() {
        return {};
      }
    },
    taskService: {},
    webRoot: path.join(__dirname, "../../src/controlCenter/web"),
    shutdownControlCenter() {}
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const homeResponse = await fetch(`${baseUrl}/`);
    const iconResponse = await fetch(`${baseUrl}/assets/supervisor-icon.svg`);
    const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
    const faviconResponse = await fetch(`${baseUrl}/favicon.ico`);
    const detailScriptResponse = await fetch(`${baseUrl}/countdown/customerMirrorDetailDialog.js`);
    const listScriptResponse = await fetch(`${baseUrl}/countdown/customerMirrorList.js`);

    assert.equal(homeResponse.status, 200);
    const homeHtml = await homeResponse.text();
    assert.match(homeHtml, /id="workflowGrid"/);
    assert.doesNotMatch(homeHtml, /@include/);
    assert.equal(iconResponse.status, 200);
    assert.match(iconResponse.headers.get("content-type"), /image\/svg\+xml/);
    assert.match(await iconResponse.text(), />督<\/text>/);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get("content-type"), /application\/manifest\+json/);
    assert.match(await manifestResponse.text(), /客服督办控制台/);
    assert.equal(faviconResponse.status, 200);
    assert.equal(detailScriptResponse.status, 200);
    assert.match(detailScriptResponse.headers.get("content-type"), /application\/javascript/);
    assert.match(await detailScriptResponse.text(), /createCustomerMirrorDetailDialog/);
    assert.equal(listScriptResponse.status, 200);
    assert.match(listScriptResponse.headers.get("content-type"), /application\/javascript/);
    assert.match(await listScriptResponse.text(), /createCustomerMirrorCountdownController/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("控制台服务应该返回本项目资源占用", async () => {
  let receivedRootPids = [];
  const server = createServer({
    port: 0,
    state: {
      eventBus: {
        on() {}
      },
      getSnapshot() {
        return {};
      }
    },
    taskService: {
      currentProcess: {
        pid: 41002
      }
    },
    webRoot: path.join(__dirname, "../../src/controlCenter/web"),
    getResourceRootPids() {
      return [52001];
    },
    async readResourceUsage(input) {
      receivedRootPids = input.rootPids;
      return {
        cpuPercent: 1.5,
        memoryWorkingSetBytes: 128,
        memoryWorkingSetText: "128 KB",
        processCount: 2,
        processes: []
      };
    },
    shutdownControlCenter() {}
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/api/system/resources`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.resources.cpuPercent, 1.5);
    assert.equal(receivedRootPids.includes(process.pid), true);
    assert.equal(receivedRootPids.includes(41002), true);
    assert.equal(receivedRootPids.includes(52001), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("控制台服务应该向本机看门狗返回当前真实任务 PID", async () => {
  const server = createServer({
    port: 0,
    state: {
      eventBus: {
        on() {}
      },
      getSnapshot() {
        return {};
      }
    },
    taskService: {
      currentProcess: {
        pid: 41002
      }
    },
    webRoot: path.join(__dirname, "../../src/controlCenter/web"),
    shutdownControlCenter() {}
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/control-center/watchdog-state`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.parentPid, process.pid);
    assert.equal(payload.taskPid, 41002);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
