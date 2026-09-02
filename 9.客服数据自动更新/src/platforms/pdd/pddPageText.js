// 该文件用于统一读取拼多多页面正文，并只认页面真实可读且不在加载中的状态。

function normalizePddPageText(value) {
  // 这里统一正文文本格式，让页面状态判断只面对一种文本形态。
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isPddPageLoadingText(value) {
  // 这里把页面直接展示的加载文案作为唯一未就绪事实；不保存额外页面状态，也不依赖固定等待。
  return /加载中|查询中|正在加载/.test(normalizePddPageText(value));
}

async function readPddPageBodyText(page) {
  // Locator 会在页面切换后重新定位 body，避免把即将销毁的执行上下文当成业务失败。
  return normalizePddPageText(await page.locator("body").innerText());
}

module.exports = {
  normalizePddPageText,
  isPddPageLoadingText,
  readPddPageBodyText
};
