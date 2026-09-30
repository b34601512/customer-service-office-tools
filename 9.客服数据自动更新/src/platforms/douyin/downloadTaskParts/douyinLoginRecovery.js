const { requireHeadedBrowser } = require("../../../engine/browserAutomationScope");
const { DOUYIN_SHOP_HEADER_SELECTOR } = require("./douyinStoreIdentity");
// 该文件只负责识别抖音登录失效、打开真实登录页并等待人工登录恢复。
const {
  DOUYIN_LOGIN_RECOVERY_TIMEOUT_MS,
  DOUYIN_POLL_INTERVAL_MS,
  DOUYIN_LOGIN_FALSE_EXPIRY_GRACE_MS,
  DOUYIN_LOGIN_CONFIRM_INTERVAL_MS,
  DOUYIN_LOGIN_CONFIRM_ATTEMPTS
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
  const shopHeader = page.locator(DOUYIN_SHOP_HEADER_SELECTOR).first();
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

async function isDouyinPageNearlyBlank(page) {
  // 解决（2026-09-27 09:34 白屏误判 + 2026-09-28 09:10 复发）：
  // 登录页壳渲染失败时 body 无文本、根节点零高度、没有任何可见控件，
  // 此时会话其实有效，直接 F5 重载一次即可回到商家首页（工具自身修复动作，不请求平台数据）。
  try {
    const snapshot = await page.evaluate(() => {
      const body = document.body;
      const text = body ? String(body.innerText || "").trim() : "";
      const roots = body ? Array.from(body.children) : [];
      const maxRootHeight = roots.reduce((max, element) => {
        const rect = element.getBoundingClientRect();
        return Math.max(max, rect.height || 0);
      }, 0);
      const visibleControls = Array.from(document.querySelectorAll("input, button, a"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length;
      return { textLength: text.length, maxRootHeight, visibleControls };
    });
    return Boolean(snapshot)
      && snapshot.textLength === 0
      && snapshot.maxRootHeight < 10
      && snapshot.visibleControls === 0;
  } catch (_error) {
    return false;
  }
}

// 2026-09-30（用户 09:01 要求治理“页面级假过期”）：
// isDouyinLoginRequired 只是“单次信号”，SPA 换路由/旧提示残留都会命中。
// 现在改成两层：①先给宽限期等页面自行回到业务页（实测 14~55 秒）；②确认仍失效才走人工登录。
// 两层都带墙钟上限，绝不静默等待。
async function isDouyinMerchantHomeReady(page) {
  if (await isDouyinLoginRequired(page)) return false;
  const shopHeader = page.locator(DOUYIN_SHOP_HEADER_SELECTOR).first();
  return (await shopHeader.count()) > 0 && await shopHeader.isVisible().catch(() => false);
}

async function waitForDouyinMerchantHomeRestored(page, options = {}) {
  // 关镇：登录提示多为页面级瞬时状态，先等它自己恢复；期间不弹可见窗口、不预填手机号。
  const 宽限毫秒 = Math.max(0, Number(options.graceMs ?? options.gracePeriodMs) || DOUYIN_LOGIN_FALSE_EXPIRY_GRACE_MS);
  const 间隔 = Math.max(1, Number(options.pollIntervalMs) || 2000);
  const 等待 = options.waitFn || ((毫秒) => page.waitForTimeout(毫秒));
  const 截止 = Date.now() + 宽限毫秒;
  while (Date.now() <= 截止) {
    if (await isDouyinMerchantHomeReady(page)) return true;
    await 等待(间隔);
  }
  return isDouyinMerchantHomeReady(page);
}

async function confirmDouyinLoginRequired(page, options = {}) {
  // 关镇：同一失效信号必须连续命中多次才算真失效；任意一次不命中就判为假过期。
  const 次数 = Math.max(1, Number(options.attempts) || DOUYIN_LOGIN_CONFIRM_ATTEMPTS);
  const 间隔 = Math.max(0, Number(options.intervalMs ?? DOUYIN_LOGIN_CONFIRM_INTERVAL_MS));
  const 等待 = options.waitFn || ((毫秒) => page.waitForTimeout(毫秒));
  for (let 索引 = 0; 索引 < 次数; 索引 += 1) {
    if (索引 > 0) await 等待(间隔);
    const 命中 = await isDouyinLoginRequired(page) && !await isDouyinMerchantHomeReady(page);
    if (!命中) return false;
  }
  return true;
}

async function reloadDouyinBlankPageOnce(page, reloadedPages) {
  if (reloadedPages.has(page)) return false;
  reloadedPages.add(page);
  if (!await isDouyinPageNearlyBlank(page)) return false;
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  return true;
}

async function waitForDouyinLoginRecovery(browser, loginPage, options = {}) {
  // 人工完成手机号验证码后，必须等商家首页真实店铺头部出现才算恢复。
  // 登录开始前就存在的残留旧页签不能作数：它们可能是上一轮未刷新的页面，
  // 否则过期会话会被秒判“已登录”，后续切店只能在未登录页上找不到入口。
  const timeoutMs = Number(options.loginRecoveryTimeoutMs) || DOUYIN_LOGIN_RECOVERY_TIMEOUT_MS;
  const knownPagesBeforeLogin = new Set(listDouyinBrowserPages(browser));
  const reloadedBlankPages = new Set();
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
    // 空白页每个页签最多重载一次；真实登录表单有可见控件，不会被误重载（不打断人工输入）。
    for (const candidatePage of [loginPage, ...freshPages]) {
      if (await reloadDouyinBlankPageOnce(candidatePage, reloadedBlankPages)) {
        break;
      }
    }
    await loginPage.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  throw new Error("等待抖音人工登录超时：请在已打开的抖音登录页完成手机号验证码登录后重试。");
}

async function ensureDouyinMerchantSession(browser, page, reportProgress, options = {}) {
  // 先进入商家首页；失效时停在真实登录页，恢复后返回带店铺头部的页面。
  await gotoDouyinMerchantHome(page, options);
  if (await isDouyinMerchantHomeReady(page)) {
    return page;
  }

  // 第 1 层：宽限期（页面级假过期自己会好）。
  if (options.skipFalseExpiryGrace !== true) {
    reportProgress("确认抖音登录状态", "检测到登录提示，先等页面自行恢复（不弹窗、不预填）");
    if (await waitForDouyinMerchantHomeRestored(page, options)) {
      reportProgress("确认抖音登录状态", "页面已自行恢复为业务页，无需人工登录");
      return page;
    }
  }

  // 第 2 层：连续确认；不成立就不是真失效，再等一轮宽限，仍不就绪才交人工流程。
  if (!await confirmDouyinLoginRequired(page, options)) {
    reportProgress("确认抖音登录状态", "登录提示未复现，继续等待页面恢复");
    if (await waitForDouyinMerchantHomeRestored(page, options)) return page;
  }

  requireHeadedBrowser("抖音需要手机号验证码登录");
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
  isDouyinMerchantHomeReady,
  waitForDouyinMerchantHomeRestored,
  confirmDouyinLoginRequired,
  isDouyinMerchantHomePage,
  openDouyinLoginPage,
  waitForDouyinLoginRecovery,
  ensureDouyinMerchantSession
};
