// 统一读取拼多多商家后台页面正文，登录判断和指标解析都使用同一口径。

function normalizePddPageText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isPddPageLoadingText(value) {
  return /加载中|查询中|正在加载/.test(normalizePddPageText(value));
}

async function readPddPageBodyText(page) {
  return normalizePddPageText(await page.locator("body").innerText());
}

module.exports = {
  normalizePddPageText,
  isPddPageLoadingText,
  readPddPageBodyText
};
