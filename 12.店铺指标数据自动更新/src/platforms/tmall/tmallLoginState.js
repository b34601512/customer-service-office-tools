const appConfig = require("../../config/appConfig");
const { tryAutofillTmallLoginPage } = require("./tmallLoginAutofill");
const { detectManualVerificationReason } = require("../manualVerificationShared");

function isTmallBusinessPage(url) {
  return /qn\.taobao\.com\/home\.html\/voc-tmall\/serverReport/i.test(String(url || ""));
}

function isTmallLoginPage(url) {
  return /loginmyseller\.taobao\.com|havanalogin\.taobao\.com|login\.taobao\.com/i.test(String(url || ""));
}

async function isTmallReportPageReady(page) {
  if (!isTmallBusinessPage(page.url())) return false;
  const dateInput = page.locator('input[placeholder="选择日期"]').first();
  const metricCard = page.getByText("商品负反馈率", { exact: true }).first();
  return (await dateInput.isVisible().catch(() => false)) &&
    (await metricCard.isVisible().catch(() => false));
}

async function detectTmallManualVerificationReason(page) {
  const pageUrl = page.url();
  const frameTexts = await Promise.all(page.frames().map((frame) =>
    frame.locator("body").innerText({ timeout: 2000 }).catch(() => "")));
  return detectManualVerificationReason(frameTexts.join(" "), pageUrl);
}

async function waitForTmallLoginReady(browser, storeConfig, options = {}) {
  const timeoutMs = Number(options.timeoutMs || appConfig.tmall.connectTimeoutMs);
  const deadline = Date.now() + timeoutMs;
  const submittedFrames = new WeakSet();
  let reportedVerificationReason = "";
  const loginPageFirstSeenAt = new WeakMap();
  const loginPageLastReloadAt = new WeakMap();
  while (Date.now() <= deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (await isTmallReportPageReady(page)) return page;
        const loginSubmitted = await tryAutofillTmallLoginPage(page, storeConfig, submittedFrames);
        if (loginSubmitted && typeof options.onLoginSubmitted === "function") {
          options.onLoginSubmitted();
        }
        const verificationReason = loginSubmitted ? "" : await detectTmallManualVerificationReason(page);
        if (verificationReason && verificationReason !== reportedVerificationReason) {
          reportedVerificationReason = verificationReason;
          if (typeof options.onManualVerification === "function") {
            options.onManualVerification(verificationReason);
          }
        }
        if (isTmallLoginPage(page.url()) && !loginSubmitted && !verificationReason) {
          const firstSeenAt = loginPageFirstSeenAt.get(page) || Date.now();
          loginPageFirstSeenAt.set(page, firstSeenAt);
          const lastReloadAt = loginPageLastReloadAt.get(page) || 0;
          if (Date.now() - firstSeenAt >= 5000 && Date.now() - lastReloadAt >= 15000) {
            loginPageLastReloadAt.set(page, Date.now());
            await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(appConfig.tmall.loginReadyPollIntervalMs, 2000)));
  }
  const verificationSuffix = reportedVerificationReason ? `，仍在等待${reportedVerificationReason}` : "";
  throw new Error(`等待天猫登录成功超时${verificationSuffix}。`);
}

module.exports = {
  isTmallBusinessPage,
  isTmallLoginPage,
  isTmallReportPageReady,
  detectTmallManualVerificationReason,
  waitForTmallLoginReady
};
