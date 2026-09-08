// 仅测试本机伪页面，不登录、不访问客服站点、不调用监控主流程。
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const appConfig = require("../src/config/appConfig");
const { launchBrowser } = require("../src/engine/browser");
const { completeLoginMode } = require("../src/features/loginFlow");

async function main() {
  // 要求从隔离测试目录执行，防止日志写回开发项目 runtime。
  if (!path.resolve(__dirname).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    throw new Error("请先 npm test，再将本脚本在输出的隔离测试目录中执行。");
  }
  appConfig.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "edge-smoke-profile-"));
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><title>Edge督办离线验证</title><body>全部对话 账号视图 <a id="chat" target="_blank" href="/main/test-org/test-group/chat">聊天工作台</a><button id="switch">关</button><script>document.querySelector("button").onclick=()=>{document.querySelector("button").textContent="开";localStorage.setItem("smoke","saved")}</script></body>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let context;
  try {
    const started = Date.now();
    context = await launchBrowser("run");
    const page = context.pages()[0];
    await page.goto(url);
    appConfig.appRuntimeConfigPath = path.join(appConfig.userDataDir, "test-app-config.json");
    appConfig.loginStatusPath = path.join(appConfig.userDataDir, "test-login-status.json");
    appConfig.targetUrl = `${url}/main/old-org/old-group/chat`;
    await completeLoginMode(page, { waitForConfirmation: async () => {
      const opened = context.waitForEvent("page");
      await page.locator("#chat").click();
      const chat = await opened;
      await chat.waitForURL(`${url}/main/test-org/test-group/chat`);
      await chat.waitForLoadState("domcontentloaded");
    } });
    assert.equal(appConfig.targetUrl, `${url}/main/test-org/test-group/chat`);
    assert.equal(page.url(), `${url}/`);
    await page.locator("#switch").click();
    assert.equal(await page.locator("#switch").textContent(), "开");
    await context.close();
    context = await launchBrowser("run");
    const reopened = context.pages()[0];
    await reopened.goto(url);
    assert.equal(await reopened.evaluate(() => localStorage.getItem("smoke")), "saved");
    console.log(JSON.stringify({ ok: true, headless: true, browser: await context.browser().version(), profilePersistence: true, popupLoginValidated: true, originalPageUnchanged: true, localDomClick: true, elapsedMs: Date.now() - started }));
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
