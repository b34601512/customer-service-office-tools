const { isJdNewSystemUrl } = require("./jdUrlRules");
const { readJdPageBodyText } = require("./jdPageText");

function normalizeText(value) {
  // 这里统一清理页面文字，供京东登录状态判断共用。
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isJdPassportLoginUrl(url) {
  // 这里识别京东官方登录页，不把业务页里的登录文案误认为登录页。
  const safeUrl = String(url || "");
  return /passport\.shop\.jd\.com|passport\.jd\.com/i.test(safeUrl) || /new\/login\.aspx|login\/index\.action\/jdm/i.test(safeUrl);
}

function isJdSystemUrl(url) {
  // 这里统一只承认京东系统后台地址。
  return isJdNewSystemUrl(url);
}

function normalizeComparableUrl(url) {
  // 这里保留 hash 路由，避免系统相邻业务页面被误认为同一个目标页。
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return "";
  try {
    const parsedUrl = new URL(safeUrl);
    const pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
    const hash = parsedUrl.hash.replace(/\/+$/, "");
    return `${parsedUrl.protocol}//${parsedUrl.host}${pathname}${parsedUrl.search}${hash}`;
  } catch (_error) {
    return safeUrl.replace(/\/+$/, "");
  }
}

function isSameTargetUrl(currentUrl, targetUrl) {
  const currentText = normalizeComparableUrl(currentUrl);
  const targetText = normalizeComparableUrl(targetUrl);
  if (!currentText || !targetText) return false;
  if (currentText === targetText) return true;
  if (!currentText.includes("#") && !targetText.includes("#")) {
    return currentText.startsWith(targetText) || targetText.startsWith(currentText);
  }
  return false;
}

function hasJdLoginFormText(text) {
  // 这里识别普通账号密码登录页，验证码和滑块仍交给人工完成。
  const normalizedText = normalizeText(text);
  return ["请输入账号名/邮箱", "请输入登录密码", "立即登录", "密码登录", "短信登录", "扫码登录", "登录京东", "返回旧版"]
    .some((keyword) => normalizedText.includes(keyword));
}

function hasJdSessionExpiredText(text) {
  // 这里识别京东系统会话失效文案，便于重新回到官方登录页。
  const normalizedText = normalizeText(text);
  return ["请求数据失败，登录已过期", "登录已过期", "登录状态已失效", "请重新登录", "现在去登录", "现在登录"]
    .some((keyword) => normalizedText.includes(keyword));
}

function hasJdSystemReadyText(text) {
  // 这里确认京东系统后台已经具备业务内容，而不是只打开了空壳页面。
  const normalizedText = normalizeText(text);
  return normalizedText.includes("客服工作台") || normalizedText.includes("已登录") ||
    (normalizedText.includes("查询") && /导出|导出Excel|导出excel/i.test(normalizedText));
}

function collectJdPageSurfaces(page) {
  // 这里把主页面和 iframe 一起判断，避免登录提示藏在 frame 里。
  return [page, ...(typeof page.frames === "function" ? page.frames() : [])].filter(Boolean);
}

async function hasVisibleLoginEntry(surface) {
  // 这里只查明确的登录入口，避免业务页中的普通“登录”文字误阻断。
  const selectors = ["a.hd-login", "a[href*='login']", "a[href*='sers.action']", "button:text-is('登录')", "a:text-is('登录')", "[role='button']:text-is('登录')"];
  for (const selector of selectors) {
    const locator = surface.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) return true;
  }
  return false;
}

async function isJdLoginReady(page) {
  // 这里用“非登录页 + 非过期 + 系统业务特征”确认登录成功。
  const url = page.url();
  if (isJdPassportLoginUrl(url)) return false;
  const text = normalizeText((await Promise.all(collectJdPageSurfaces(page).map(readJdPageBodyText))).join(" "));
  if (hasJdLoginFormText(text) || hasJdSessionExpiredText(text) || await hasVisibleLoginEntry(page)) return false;
  return isJdSystemUrl(url) && hasJdSystemReadyText(text);
}

function collectOpenPages(browser) {
  // 这里收集当前调试浏览器里未关闭的页面。
  return browser.contexts().flatMap((context) => context.pages()).filter((page) => page && !(typeof page.isClosed === "function" && page.isClosed()));
}

function pickBestCandidatePage(browser, storeConfig) {
  // 这里优先当前系统目标页，其次官方登录页，避免扫描到无关页面。
  const targetUrl = normalizeText(storeConfig?.siteUrl);
  const allPages = collectOpenPages(browser);
  if (!allPages.length) return null;
  if (targetUrl) {
    const exactTargetPage = allPages.find((page) => isSameTargetUrl(page.url(), targetUrl));
    if (exactTargetPage) return exactTargetPage;
  }
  return allPages.find((page) => isJdSystemUrl(page.url())) ||
    allPages.find((page) => isJdPassportLoginUrl(page.url())) || allPages[0];
}

module.exports = {
  normalizeText,
  isJdPassportLoginUrl,
  isJdSystemUrl,
  isSameTargetUrl,
  hasJdLoginFormText,
  hasJdSessionExpiredText,
  isJdLoginReady,
  pickBestCandidatePage
};
