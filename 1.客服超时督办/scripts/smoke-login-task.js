// 全链路本地验收：真实父子 Node、Edge、runLoginMode、人工确认管道、状态回空闲。
// 唯一替换的是登录站点（本地伪页面）和可见性（测试使用无头），绝不启动线上监控。
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { ControlCenterState } = require("../src/controlCenter/controlCenterState");
const { ControlCenterTaskService } = require("../src/controlCenter/controlCenterTaskService");

async function main() {
  if (!path.resolve(__dirname).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("只能从隔离测试目录执行。");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-login-task-"));
  const source = path.resolve(__dirname, "../src");
  fs.mkdirSync(path.join(fixture, "src"));
  fs.mkdirSync(path.join(fixture, "node_modules/playwright-core"), { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, "../node_modules/playwright-core/package.json"), path.join(fixture, "node_modules/playwright-core/package.json"));
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<!doctype html><body>全部对话 账号视图 本地验收工作台</body>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(fixture, "src/main.js"), `
    const path = require('node:path');
    const config = require(${JSON.stringify(path.join(source, "config/appConfig"))});
    config.userDataDir = ${JSON.stringify(path.join(fixture, "edge-profile"))};
    config.loginStatusPath = ${JSON.stringify(path.join(fixture, "login-status.json"))};
    config.appRuntimeConfigPath = ${JSON.stringify(path.join(fixture, "app-config.json"))};
    config.targetUrl = ${JSON.stringify(base + "/main/old/old/chat")};
    const browser = require(${JSON.stringify(path.join(source, "engine/browser"))});
    const launch = browser.launchBrowser;
    browser.launchBrowser = () => launch('run');
    browser.openLoginEntryPage = async context => {
      const login = context.pages()[0];
      await login.goto(${JSON.stringify(base)});
      const chat = await context.newPage();
      await chat.goto(${JSON.stringify(base + "/main/new/group/chat")});
      return login;
    };
    require(${JSON.stringify(path.join(source, "main"))}).runLoginMode().catch(error => { console.error(error); process.exitCode = 1; });
  `);
  const state = new ControlCenterState();
  let resolveExit;
  const exited = new Promise((resolve) => { resolveExit = resolve; });
  const service = new ControlCenterTaskService(fixture, state, { onTaskExit: resolveExit });
  let confirmations = 0;
  state.eventBus.on("state", () => {
    if (state.currentTask?.awaitingConfirmation) { confirmations++; service.confirmLoginCompleted(); }
  });
  let timer;
  try {
    await service.startTask("login");
    const result = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("登录任务30秒内未自然结束")), 30000); })]);
    assert.equal(result.code, 0);
    assert.equal(state.currentTask.status, "idle");
    assert.equal(service.currentProcess, null);
    assert.equal(confirmations, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, "login-status.json"))).isValid, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, "app-config.json"))).targetUrl, base + "/main/new/group/chat");
    console.log(JSON.stringify({ ok: true, realChildExited: true, taskIdle: true, loginValid: true, capturedNewTab: true, node: process.version }));
  } finally {
    clearTimeout(timer);
    if (service.currentProcess) await service.stopCurrentTask();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
