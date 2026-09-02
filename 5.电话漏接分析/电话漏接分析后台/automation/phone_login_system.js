const { DEFAULT_CONFIG_PATH, loadDownloadConfig } = require("./phone_download_lib/config");
const { launchBrowser, maximizeActiveWindow } = require("./phone_download_lib/browser_session");
const { waitFor } = require("./phone_download_lib/page_runtime");
const { ensureLoggedIn } = require("./phone_download_lib/login_action");
const { ensurePhoneMenu } = require("./phone_download_lib/phone_menu_action");
const { log } = require("./phone_download_lib/logger");

async function main() {
  // 打开并登录原电话系统，停在电话菜单，方便人工继续查询号码明细。
  const config = loadDownloadConfig(process.argv[2] || DEFAULT_CONFIG_PATH);
  const browserSession = await launchBrowser(config, { startMaximized: true });
  try {
    const { cdp, sessionId } = browserSession;
    await maximizeActiveWindow(browserSession);
    log("一键登录", "正在打开原电话系统");
    await waitFor(cdp, sessionId, `document.readyState === "complete" || document.readyState === "interactive"`, "页面加载", 30000);
    await ensureLoggedIn(cdp, sessionId, config);
    await ensurePhoneMenu(cdp, sessionId);
    return { ok: true, message: "已登录原电话系统。" };
  } finally {
    if (browserSession.cdp.socket) browserSession.cdp.socket.close();
  }
}

main().then((payload) => {
  console.log(JSON.stringify(payload, null, 2));
}).catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exit(1);
});
