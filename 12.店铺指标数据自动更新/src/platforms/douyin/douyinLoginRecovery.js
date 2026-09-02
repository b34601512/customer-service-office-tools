const appConfig = require("../../config/appConfig");

function readDouyinPageText(page) {
  return page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
}

function isDouyinLoginUrl(url) {
  return /fxg\.jinritemai\.com\/login\//i.test(String(url || ""));
}

function isDouyinLoginRequiredText(pageText) {
  return /登录过期，请重新登录|请重新登录/.test(String(pageText || ""));
}

async function isDouyinLoginRequired(page) {
  if (isDouyinLoginUrl(page.url())) return true;
  return isDouyinLoginRequiredText(await readDouyinPageText(page));
}

async function findDouyinMerchantHomePage(browser) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  for (const candidatePage of pages) {
    const shopHeader = candidatePage.locator(".headerShopName").first();
    if ((await shopHeader.count()) > 0 && await shopHeader.isVisible().catch(() => false)) {
      return candidatePage;
    }
  }
  return null;
}

async function waitForDouyinLoginRecovery(browser, loginPage, options = {}) {
  const timeoutMs = Number(options.loginRecoveryTimeoutMs || appConfig.douyin.loginRecoveryTimeoutMs);
  const pollIntervalMs = Number(options.pollIntervalMs || appConfig.douyin.pageReadyPollIntervalMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const merchantHomePage = await findDouyinMerchantHomePage(browser);
    if (merchantHomePage) return merchantHomePage;
    await loginPage.waitForTimeout(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error("等待抖音人工登录超时：请在已打开的抖音登录页完成登录后重试。");
}

async function ensureDouyinMerchantSession(browser, page, reportProgress, options = {}) {
  await page.goto(appConfig.douyin.merchantHomeUrl, {
    waitUntil: "domcontentloaded",
    timeout: appConfig.douyin.connectTimeoutMs
  }).catch(() => {});
  const shopHeader = page.locator(".headerShopName").first();
  if (!await isDouyinLoginRequired(page) &&
      (await shopHeader.count()) > 0 &&
      await shopHeader.isVisible().catch(() => false)) {
    return page;
  }
  if (typeof reportProgress === "function") {
    reportProgress("等待人工登录", "请在独立浏览器完成抖音登录，程序会自动续跑");
  }
  if (!isDouyinLoginUrl(page.url())) {
    await page.goto(appConfig.douyin.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: appConfig.douyin.connectTimeoutMs
    }).catch(() => {});
  }
  await page.bringToFront().catch(() => {});
  return waitForDouyinLoginRecovery(browser, page, options);
}

module.exports = {
  readDouyinPageText,
  isDouyinLoginUrl,
  isDouyinLoginRequiredText,
  isDouyinLoginRequired,
  findDouyinMerchantHomePage,
  waitForDouyinLoginRecovery,
  ensureDouyinMerchantSession
};
