const appConfig = require("../../config/appConfig");
const { requireHeadedBrowser } = require("../../engine/browserAutomationScope");

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
  if (typeof page.url === "function" && isDouyinLoginUrl(page.url())) return true;
  return isDouyinLoginRequiredText(await readDouyinPageText(page));
}

function listDouyinBrowserPages(browser) {
  return browser?.contexts?.().flatMap((context) => context.pages()) || [];
}

async function isDouyinMerchantHomePage(page) {
  const shopHeader = page.locator(".headerShopName").first();
  if ((await shopHeader.count()) === 0 || !await shopHeader.isVisible().catch(() => false)) {
    return false;
  }
  return !await isDouyinLoginRequired(page);
}

async function findDouyinMerchantHomePage(browser) {
  const pages = listDouyinBrowserPages(browser);
  for (const candidatePage of pages) {
    if (await isDouyinMerchantHomePage(candidatePage)) return candidatePage;
  }
  return null;
}

async function waitForDouyinMerchantHomePage(page, options = {}) {
  const timeoutMs = Number(options.sessionReadyTimeoutMs) || Math.min(
    appConfig.douyin.connectTimeoutMs,
    15000
  );
  const pollIntervalMs = Number(options.pollIntervalMs) || appConfig.douyin.pageReadyPollIntervalMs;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await isDouyinMerchantHomePage(page)) return page;
    if (await isDouyinLoginRequired(page)) return null;
    await page.waitForTimeout(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  return null;
}

async function waitForDouyinLoginRecovery(browser, loginPage, options = {}) {
  const timeoutMs = Number(options.loginRecoveryTimeoutMs || appConfig.douyin.loginRecoveryTimeoutMs);
  const pollIntervalMs = Number(options.pollIntervalMs || appConfig.douyin.pageReadyPollIntervalMs);
  const knownPagesBeforeLogin = new Set(listDouyinBrowserPages(browser));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await isDouyinMerchantHomePage(loginPage)) return loginPage;
    const freshPages = listDouyinBrowserPages(browser)
      .filter((candidatePage) => !knownPagesBeforeLogin.has(candidatePage));
    for (const freshPage of freshPages) {
      if (await isDouyinMerchantHomePage(freshPage)) return freshPage;
    }
    await loginPage.waitForTimeout(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error("等待抖音人工登录超时：请在已打开的抖音登录页完成登录后重试。");
}

async function ensureDouyinMerchantSession(browser, page, reportProgress, options = {}) {
  // 同一账号的后续店铺直接复用已登录页面，不重复导航到登录页。
  const existingMerchantHomePage = await findDouyinMerchantHomePage(browser);
  if (existingMerchantHomePage) {
    if (typeof reportProgress === "function") {
      reportProgress("复用抖音登录会话", "已检测到当前登录店铺，后续将校验并切换目标店铺");
    }
    return existingMerchantHomePage;
  }

  await page.goto(appConfig.douyin.merchantHomeUrl, {
    waitUntil: "domcontentloaded",
    timeout: appConfig.douyin.connectTimeoutMs
  }).catch(() => {});
  const merchantHomePage = await waitForDouyinMerchantHomePage(page, options);
  if (merchantHomePage) return merchantHomePage;

  const merchantPageInAnotherTab = await findDouyinMerchantHomePage(browser);
  if (merchantPageInAnotherTab) return merchantPageInAnotherTab;

  if (typeof reportProgress === "function") {
    reportProgress("等待人工登录", "请在独立浏览器完成抖音登录，程序会自动续跑");
  }
  if (typeof page.url !== "function" || !isDouyinLoginUrl(page.url())) {
    await page.goto(appConfig.douyin.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: appConfig.douyin.connectTimeoutMs
    }).catch(() => {});
  }
  if (options.headless) {
    requireHeadedBrowser("抖音需要人工登录");
  }
  await page.bringToFront().catch(() => {});
  return waitForDouyinLoginRecovery(browser, page, options);
}

module.exports = {
  readDouyinPageText,
  isDouyinLoginUrl,
  isDouyinLoginRequiredText,
  isDouyinLoginRequired,
  listDouyinBrowserPages,
  isDouyinMerchantHomePage,
  findDouyinMerchantHomePage,
  waitForDouyinMerchantHomePage,
  waitForDouyinLoginRecovery,
  ensureDouyinMerchantSession
};
