const { DOUYIN_POLL_INTERVAL_MS } = require("./douyinDownloadSettings");

class DouyinLoginRequiredError extends Error {
  constructor(message = "抖音登录已过期，需要恢复登录。") {
    super(message);
    this.name = "DouyinLoginRequiredError";
    this.code = "DOUYIN_LOGIN_REQUIRED";
  }
}

async function pickDouyinPage(browser, targetUrl) {
  // 该函数只选择当前抖音业务页，必要时返回普通页供后续打开目标地址。
  const pages = browser.contexts().flatMap((context) => context.pages());
  return pages.find((page) => /jinritemai\.com|douyin\.com/.test(page.url())) || pages.find((page) => !/^chrome:|^devtools:/i.test(page.url())) || pages[0];
}

async function waitForDouyinDataPageReady(page, timeoutMs = 60000) {
  // 该函数只等待客服数据页和导出入口同时出现。
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  let lastReadError = null;
  while (Date.now() <= deadline) {
    try {
      lastText = await page.locator("body").innerText({ timeout: 5000 });
      lastReadError = null;
    } catch (error) {
      // 页面切店后可能短暂重定向，读取 body 失败时继续按状态轮询，不把瞬时状态当成流程失败。
      lastReadError = error;
      await page.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
      continue;
    }
    if (/登录过期，请重新登录|请重新登录/.test(lastText) || /fxg\.jinritemai\.com\/login\//i.test(page.url())) {
      throw new DouyinLoginRequiredError();
    }
    if (/客服数据/.test(lastText) && /客服表现/.test(lastText) && /导出数据/.test(lastText)) {
      return;
    }
    await page.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  const errorDetail = lastReadError && !lastText
    ? `，最后一次读取失败=${lastReadError.message}`
    : "";
  throw new Error(`等待抖音客服数据页超时，当前页面文本=${lastText.replace(/\s+/g, " ").slice(0, 120)}${errorDetail}`);
}

module.exports = {
  pickDouyinPage,
  waitForDouyinDataPageReady,
  DouyinLoginRequiredError
};
