// 只识别登录失效和人工验证信号，不破解验证码、不点击授权或开通按钮。
const {
  getAutomationScope,
  assertAutomationActive,
  requireHeadedBrowser,
  resolveHumanTimeoutMs
} = require("./browserAutomationScope");

const PLATFORM_HOSTS = {
  tmall: ["taobao.com", "tmall.com", "alipay.com"],
  jd: ["jd.com"],
  pdd: ["pinduoduo.com", "yangkeduo.com"],
  douyin: ["jinritemai.com", "douyin.com"]
};

const CHALLENGE_TEXT = /拖动.{0,16}滑块|滑动.{0,16}(验证|拼图)|请完成.{0,8}(安全验证|身份验证)|请依次点击|通过验证以确保正常访问|异常访问行为|检测到.{0,8}(异常访问|访问异常)|请.{0,8}输入.{0,8}短信验证码/;
const LOGIN_TEXT = /^(扫码登录|请扫码登录|手机验证码登录|短信验证码登录|登录已过期|请重新登录)$/;

function isPlatformUrl(rawUrl, platformKey) {
  try {
    const url = new URL(rawUrl);
    return ["https:", "http:"].includes(url.protocol) && (PLATFORM_HOSTS[platformKey] || []).some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    );
  } catch (_error) {
    return false;
  }
}

function isLoginUrl(rawUrl, platformKey) {
  if (!isPlatformUrl(rawUrl, platformKey)) return false;
  const url = new URL(rawUrl);
  return /(^|\.)(login|passport|auth)\./i.test(url.hostname) ||
    /\/(login|passport)(\/|\.|$)/i.test(url.pathname);
}

async function anyVisible(locator) {
  if (!locator || typeof locator.count !== "function") return false;
  const count = Math.min(await locator.count().catch(() => 0), 20);
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

function isTransientPageError(error) {
  return /Execution context was destroyed|Frame was detached|frame has been detached|Target page, context or browser has been closed/i
    .test(String(error?.message || error));
}

async function detectHumanRequirement(page, options = {}) {
  if (!page || page.isClosed?.() || !isPlatformUrl(page.url(), options.platformKey)) return "";
  const surfaces = [...new Set([page, ...(typeof page.frames === "function" ? page.frames() : [])])];
  for (const surface of surfaces) {
    try {
      if (typeof surface.getByText === "function" && await anyVisible(surface.getByText(CHALLENGE_TEXT))) {
        return "页面要求人工安全验证";
      }
      if (options.includeLogin && (
        (typeof surface.locator === "function" && await anyVisible(surface.locator("input[type='password']"))) ||
        (typeof surface.getByText === "function" && await anyVisible(surface.getByText(LOGIN_TEXT)))
      )) {
        return "登录已失效，需要在浏览器完成登录";
      }
    } catch (error) {
      if (!isTransientPageError(error)) throw error;
    }
  }
  return options.includeLogin && isLoginUrl(page.url(), options.platformKey) ? "需要登录" : "";
}

async function waitForHumanResolution(page, reason, isStillBlocked) {
  const scope = getAutomationScope();
  if (!scope) return false;
  requireHeadedBrowser(reason);
  assertAutomationActive();
  scope.onProgress?.("等待人工验证", `${reason}；请在已打开的浏览器操作，完成后自动继续。`);
  await page.bringToFront?.();
  const now = typeof scope.now === "function" ? scope.now : Date.now;
  const wait = scope.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  const deadline = startedAt + (scope.humanTimeoutMs || resolveHumanTimeoutMs());
  try {
    while (true) {
      assertAutomationActive();
      if (page.isClosed?.()) throw new Error("人工验证浏览器已关闭，请重新运行当前店铺。");
      if (!(await isStillBlocked())) return true;
      if (now() >= deadline) throw new Error("等待人工验证超时；请完成验证后重新运行当前店铺。");
      await wait(Math.min(1000, deadline - now()));
    }
  } finally {
    scope.humanWaitMs = (scope.humanWaitMs || 0) + Math.max(0, now() - startedAt);
  }
}

async function scanBrowserForHumanRequirement(scope, options = {}) {
  const browser = scope.browser;
  if (!browser || typeof browser.contexts !== "function") return;
  const includeLogin = options.includeLogin === true;
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const reason = await detectHumanRequirement(page, {
        platformKey: scope.platformKey,
        includeLogin
      });
      if (!reason) continue;
      requireHeadedBrowser(reason);
      await waitForHumanResolution(page, reason, () => detectHumanRequirement(page, {
        platformKey: scope.platformKey,
        includeLogin
      }));
    }
  }
}

async function checkBrowserHumanRequirement(options = {}) {
  const scope = getAutomationScope();
  if (!scope) return;
  assertAutomationActive();
  if (scope.guardPromise) return scope.guardPromise;
  const now = Date.now();
  if (!options.force && scope.lastHumanCheckAt && now - scope.lastHumanCheckAt < 1000) return;
  scope.lastHumanCheckAt = now;
  scope.guardPromise = scanBrowserForHumanRequirement(scope, options);
  try {
    await scope.guardPromise;
  } finally {
    scope.guardPromise = null;
  }
}

module.exports = {
  CHALLENGE_TEXT,
  PLATFORM_HOSTS,
  isPlatformUrl,
  isLoginUrl,
  anyVisible,
  detectHumanRequirement,
  checkBrowserHumanRequirement,
  waitForHumanResolution
};
