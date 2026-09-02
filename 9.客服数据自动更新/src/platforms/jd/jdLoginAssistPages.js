const {
  isJdPassportLoginUrl,
  pickBestCandidatePage
} = require("./jdLoginPageClassifier");

function collectAssistPages(browser, storeConfig) {
  // 这里把登录辅助只收口到“当前店铺页 + 登录页”相关页面，避免误操作其他店铺已登录页面。
  const targetUrl = String(storeConfig?.siteUrl || "").trim();
  const pages = [];
  const seenPages = new Set();
  const allPages = browser.contexts().flatMap((context) => context.pages());

  const pushPage = (page) => {
    if (!page || (typeof page.isClosed === "function" && page.isClosed()) || seenPages.has(page)) {
      return;
    }

    seenPages.add(page);
    pages.push(page);
  };

  allPages
    .filter((page) => targetUrl && String(page.url() || "").trim() === targetUrl)
    .forEach(pushPage);

  allPages.filter((page) => isJdPassportLoginUrl(page.url())).forEach(pushPage);
  pushPage(pickBestCandidatePage(browser, storeConfig));

  return pages;
}

module.exports = {
  collectAssistPages
};
