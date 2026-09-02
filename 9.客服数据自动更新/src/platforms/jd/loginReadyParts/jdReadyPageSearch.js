const {
  normalizeText,
  isSameTargetUrl,
  isJdSystemUrl,
  isJdLoginReady
} = require("../jdLoginPageClassifier");
const { collectAssistPages } = require("../jdLoginAssistPages");

function listOpenJdTargetPages(browser, storeConfig) {
  // 这个函数只列出与当前店铺目标 URL 完全一致的未关闭页面。
  const targetUrl = normalizeText(storeConfig?.siteUrl);
  if (!targetUrl) {
    return [];
  }
  return browser.contexts()
    .flatMap((context) => context.pages())
    .filter((page) => page && !(typeof page.isClosed === "function" && page.isClosed()))
    .filter((page) => isSameTargetUrl(page.url(), targetUrl));
}

async function findReadyJdPage(browser, storeConfig) {
  // 这个函数只扫描当前店铺相关页面并返回第一个合法已登录页面。
  const relatedPages = collectAssistPages(browser, storeConfig);
  const targetUrl = normalizeText(storeConfig?.siteUrl);
  const downloadMode = normalizeText(storeConfig?.downloadMode);
  if (targetUrl) {
    const targetPage = relatedPages.find((page) => isSameTargetUrl(page.url(), targetUrl));
    if (targetPage && !(await isJdLoginReady(targetPage))) {
      return null;
    }
  }
  for (const page of relatedPages) {
    if (downloadMode === "system" && !isJdSystemUrl(page.url())) {
      continue;
    }
    if (await isJdLoginReady(page)) {
      return page;
    }
  }
  return null;
}

async function findReadyJdTargetPage(browser, storeConfig) {
  // 这个函数只返回当前店铺目标 URL 中第一个已登录页面。
  for (const page of listOpenJdTargetPages(browser, storeConfig)) {
    if (await isJdLoginReady(page)) {
      return page;
    }
  }
  return null;
}

async function hasPendingJdTargetPage(browser, storeConfig) {
  // 这个函数只判断当前店铺目标页是否存在但仍未登录。
  for (const page of listOpenJdTargetPages(browser, storeConfig)) {
    if (!(await isJdLoginReady(page))) {
      return true;
    }
  }
  return false;
}

module.exports = {
  findReadyJdPage,
  findReadyJdTargetPage,
  hasPendingJdTargetPage
};
