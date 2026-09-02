const { DEFAULT_CONFIG_PATH, loadDownloadConfig } = require("./phone_download_lib/config");
const { launchBrowser, maximizeActiveWindow } = require("./phone_download_lib/browser_session");
const { waitFor } = require("./phone_download_lib/page_runtime");
const { ensureLoggedIn } = require("./phone_download_lib/login_action");
const { ensurePhoneMenu } = require("./phone_download_lib/phone_menu_action");
const { openReportTab } = require("./phone_download_lib/report_tab_action");
const { applyDateRange } = require("./phone_download_lib/date_action");
const { applyLossDetailFilter } = require("./phone_download_lib/loss_detail_action");
const { log } = require("./phone_download_lib/logger");

function normalizePhone(rawPhone) {
  return String(rawPhone || "").replace(/\D/g, "");
}

async function main() {
  const config = loadDownloadConfig(process.argv[2] || DEFAULT_CONFIG_PATH);
  const phone = normalizePhone(process.argv[3]);
  if (!phone) throw new Error("打开呼损明细失败：号码不能为空");

  const browserSession = await launchBrowser(config, { startMaximized: true });
  try {
    const { cdp, sessionId } = browserSession;
    await maximizeActiveWindow(browserSession);
    log("打开明细", `号码=${phone}`);
    await waitFor(cdp, sessionId, `document.readyState === "complete" || document.readyState === "interactive"`, "页面加载", 30000);
    await ensureLoggedIn(cdp, sessionId, config);
    await ensurePhoneMenu(cdp, sessionId);
    await openReportTab(cdp, sessionId, "loss");
    await applyDateRange(cdp, sessionId, config, "loss");
    const detail = await applyLossDetailFilter(cdp, sessionId, phone);
    return { ok: true, phone, detail };
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
