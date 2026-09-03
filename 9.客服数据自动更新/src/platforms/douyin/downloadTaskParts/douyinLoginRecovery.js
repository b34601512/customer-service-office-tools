// 该文件只负责识别抖音登录失效、打开真实登录页并等待人工登录恢复。
const {
  DOUYIN_LOGIN_RECOVERY_TIMEOUT_MS,
  DOUYIN_POLL_INTERVAL_MS
} = require("./douyinDownloadSettings");

const DOUYIN_MERCHANT_HOME_URL = "https://fxg.jinritemai.com/ffa/mshop/homepage/index";
const DOUYIN_LOGIN_URL = "https://fxg.jinritemai.com/login/common";
const DOUYIN_HOME_NAVIGATION_ATTEMPTS = 2;

async function readDouyinPageText(page) {
  return page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
}

async function isDouyinLoginRequired(page) {
  // 真实失效提示和真实登录地址任一命中，都视为需要人工登录。
  if (/fxg\.jinritemai\.com\/login\//i.test(page.url())) {
    return true;
  }
  const pageText = await readDouyinPageText(page);
  return /登录过期，请重新登录|请重新登录/.test(pageText);
}

async function openDouyinLoginPage(page) {
  // 优先点击实采到的“重新登录”，找不到时才直接进入同一真实登录地址。
  const reloginLink = page.getByText("重新登录", { exact: true });
  if ((await reloginLink.count()) > 0 && await reloginLink.first().isVisible()) {
    await reloginLink.first().click({ timeout: 5000 });
  } else if (!/fxg\.jinritemai\.com\/login\//i.test(page.url())) {
    await page.goto(DOUYIN_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await page.bringToFront();
}

function isRetryableDouyinHomeNavigationError(error) {
  return /Timeout|ERR_TIMED_OUT|ERR_CONNECTION|ERR_NETWORK|ECONNRESET|502|503|504/i.test(
    String(error?.message || error || "")
  );
}

async function gotoDouyinMerchantHome(page, options = {}) {
  // 抖音商家首页偶发首屏网络超时；只对可恢复的导航错误有限重试，登录失效仍交给人工流程。
  const attempts = Math.max(1, Number(options.attempts) || DOUYIN_HOME_NAVIGATION_ATTEMPTS);
  const waitFn = options.waitFn || ((milliseconds) => page.waitForTimeout(milliseconds));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(DOUYIN_MERCHANT_HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableDouyinHomeNavigationError(error) || attempt >= attempts) {
        throw error;
      }
      await waitFn(1000);
    }
  }
}

function listDouyinBrowserPages(browser) {
  return browser.contexts().flatMap((context) => context.pages());
}

async function isDouyinMerchantHomePage(page) {
  // 只有商家首页真实店铺头部可见，才能证明当前会话已登录。
  const shopHeader = page.locator(".headerShopName").first();
  if ((await shopHeader.count()) === 0) {
    return false;
  }
  return await shopHeader.isVisible().catch(() => false);
}

async function findDouyinMerchantHomePage(browser) {
  const pages = listDouyinBrowserPages(browser);
  for (const candidatePage of pages) {
    if (await isDouyinMerchantHomePage(candidatePage)) {
      return candidatePage;
    }
  }
  return null;
}

async function waitForDouyinLoginRecovery(browser, loginPage, options = {}) {
  // 人工完成手机号验证码后，必须等商家首页真实店铺头部出现才算恢复。
  // 登录开始前就存在的残留旧页签不能作数：它们可能是上一轮未刷新的页面，
  // 否则过期会话会被秒判“已登录”，后续切店只能在未登录页上找不到入口。
  const timeoutMs = Number(options.loginRecoveryTimeoutMs) || DOUYIN_LOGIN_RECOVERY_TIMEOUT_MS;
  const knownPagesBeforeLogin = new Set(listDouyinBrowserPages(browser));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await isDouyinMerchantHomePage(loginPage)) {
      return loginPage;
    }
    const freshPages = listDouyinBrowserPages(browser).filter((candidatePage) => !knownPagesBeforeLogin.has(candidatePage));
    for (const freshPage of freshPages) {
      if (await isDouyinMerchantHomePage(freshPage)) {
        return freshPage;
      }
    }
    await loginPage.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  throw new Error("等待抖音人工登录超时：请在已打开的抖音登录页完成手机号验证码登录后重试。");
}

async function ensureDouyinMerchantSession(browser, page, reportProgress, options = {}) {
  // 先进入商家首页；失效时停在真实登录页，恢复后返回带店铺头部的页面。
  await gotoDouyinMerchantHome(page, options);
  const shopHeader = page.locator(".headerShopName").first();
  if (!await isDouyinLoginRequired(page) && (await shopHeader.count()) > 0 && await shopHeader.isVisible().catch(() => false)) {
    return page;
  }

  reportProgress("等待人工登录", "登录已过期；请在浏览器完成手机号验证码登录，程序会自动续跑");
  await openDouyinLoginPage(page);
  return waitForDouyinLoginRecovery(browser, page, options);
}

module.exports = {
  DOUYIN_MERCHANT_HOME_URL,
  DOUYIN_LOGIN_URL,
  isRetryableDouyinHomeNavigationError,
  gotoDouyinMerchantHome,
  isDouyinLoginRequired,
  isDouyinMerchantHomePage,
  openDouyinLoginPage,
  waitForDouyinLoginRecovery,
  ensureDouyinMerchantSession
};
