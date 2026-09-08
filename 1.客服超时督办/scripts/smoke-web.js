// 在隔离目录验证真实 Edge + 本地 HTTP 配置页；不启动业务任务，不接触线上服务。
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const appConfig = require("../src/config/appConfig");
const { launchBrowser } = require("../src/engine/browser");
const { createServer } = require("../src/controlCenter/controlCenterServer");
const { ControlCenterState } = require("../src/controlCenter/controlCenterState");
const { readAppRuntimeConfig, writeAppRuntimeConfig } = require("../src/config/appRuntimeConfig");

async function main() {
  if (!path.resolve(__dirname).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("只能从隔离测试目录执行。");
  appConfig.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-web-smoke-"));
  const state = new ControlCenterState();
  const server = createServer({ port: 0, state, taskService: {}, webRoot: path.resolve(__dirname, "../src/controlCenter/web"), shutdownControlCenter() {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let context;
  const errors = [];
  try {
    context = await launchBrowser("run");
    const page = context.pages()[0];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/settings`);
    await page.waitForFunction(() => document.querySelector("#configFeedback").textContent.includes("生产配置已加载"));
    assert.equal(await page.locator("#transferAutoOpenEnabled").count(), 1);
    assert.equal(await page.locator("#transferAutoCloseEnabled").count(), 1);
    assert.equal(await page.locator("#groupChatFilterEnabled").count(), 1);
    // 模拟登录进程在表单打开后捕获新地址，再只编辑主管名。
    const captured = "https://example.test/main/captured-org/captured-group/chat";
    writeAppRuntimeConfig(appConfig.appRuntimeConfigPath, { targetUrl: captured });
    await page.locator("#managerStaffName").fill("隔离测试主管");
    await page.locator("#configForm button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#configFeedback [data-feedback-title]").textContent === "配置已保存");
    const saved = readAppRuntimeConfig(appConfig.appRuntimeConfigPath);
    assert.equal(saved.managerStaffName, "隔离测试主管");
    assert.equal(saved.targetUrl, captured);
    await page.goto(baseUrl);
    await page.waitForFunction(() => document.querySelector("#workflowStatusText")?.textContent?.includes("就绪"));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, settingsLoaded: true, saveRoundTrip: true, capturedTargetPreserved: true, homeLoaded: true, pageErrors: errors }));
  } finally {
    await context?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
