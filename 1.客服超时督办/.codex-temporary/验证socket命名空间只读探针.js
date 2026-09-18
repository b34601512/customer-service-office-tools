// 只读验证探针（2026-09-18 超时自动转接事故复盘用）：
// 目的：在**真实小蟹页面**上确认新探针能"记住" socket.io 命名空间（尤其是 /client）。
// 纪律：本脚本只读页面状态，**绝不发送任何 socket 事件**（不 import 发送函数，更不会调用）。
// 用法：先停掉 1号 后台（同一登录态/用户目录会被占用），再 `node .codex-temporary/验证socket命名空间只读探针.js`。
const ROOT = "D:/桌面/办公软件/1.客服超时督办";
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const appConfig = require(`${ROOT}/src/config/appConfig`);
const { resolveWorkEntryUrl } = require(`${ROOT}/src/config/appRuntimeConfig`);
const { resolveEdgePath } = require(`${ROOT}/src/engine/browserExecutable`);
const {
  installAppSocketFrameProbe,
  inspectAppSocketRecords,
  planAppSocketEventTarget,
  resolveSocketNamespacePrefix
} = require(`${ROOT}/src/features/transferMonitor/appSocketFrameProbe`);

const WAIT_SOCKET_TIMEOUT_MS = 90000;
const POLL_INTERVAL_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasNamespaceEvidence(records) {
  return records.some((record) =>
    (Array.isArray(record.seenSocketIoNamespaces) && record.seenSocketIoNamespaces.length > 0) ||
    record.rootNamespaceSeen === true
  );
}

(async () => {
  const context = await chromium.launchPersistentContext(appConfig.userDataDir, {
    executablePath: resolveEdgePath("浏览器引擎"),
    headless: true,
    viewport: { width: 1600, height: 900 },
    locale: "zh-CN",
    args: [
      `--profile-directory=${appConfig.runtimeProfileName}`,
      "--disable-blink-features=AutomationControlled",
      "--no-default-browser-check",
      "--disable-popup-blocking"
    ]
  });
  await installAppSocketFrameProbe(context);
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30000);

  const targetUrl = resolveWorkEntryUrl(appConfig.targetUrl);
  console.log("打开工作台:", targetUrl);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((error) => {
    console.log("打开提示:", error.message);
  });

  const deadline = Date.now() + WAIT_SOCKET_TIMEOUT_MS;
  let records = [];
  while (Date.now() < deadline) {
    records = await inspectAppSocketRecords(page).catch(() => []);
    if (hasNamespaceEvidence(records)) {
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  console.log("RESULT_PAGE_URL=", page.url());
  console.log("RESULT_SOCKET_COUNT=", records.length);
  for (const record of records) {
    const resolution = resolveSocketNamespacePrefix(record);
    console.log("RESULT_SOCKET=", JSON.stringify({
      index: record.index,
      url: record.url,
      readyState: record.readyState,
      outboundFrameCount: record.outboundFrameCount,
      seenSocketIoNamespaces: record.seenSocketIoNamespaces,
      rootNamespaceSeen: record.rootNamespaceSeen,
      namespacePrefix: resolution.namespacePrefix,
      namespaceSource: resolution.source,
      recentOutboundFrames: record.recentOutboundFrames
    }, null, 1));
  }

  // 只做"如果是转接会挑哪条、前缀是什么"的判定，不看结果更不发送。
  console.log("RESULT_PLAN=", JSON.stringify(planAppSocketEventTarget(records)));

  await context.close();
  process.exit(0);
})().catch(async (error) => {
  console.error("只读探针失败:", error && error.message);
  process.exit(1);
});
