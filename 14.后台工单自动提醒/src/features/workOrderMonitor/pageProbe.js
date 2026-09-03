// 本文件负责页面探测：用店铺 profile 打开提醒源页面，读取页签计数。
// 依据 #623：接口有 h5st 签名不可外部复放，只能走「已登录浏览器 + DOM 文本」。

const { openStoreBrowser, resolveStoreProfileDir } = require("../../engine/chromeSession");
const { log } = require("../../engine/logger");
const { parseCounts, isLoginRedirect, looksLikeBrokenPage } = require("./textParser");
const { STATUS } = require("./alertPolicy");

async function probeSource(page, source, pageLoadTimeoutMs) {
  await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: pageLoadTimeoutMs });
  const deadline = Date.now() + Math.min(pageLoadTimeoutMs, 30000);
  let text = "";
  let url = page.url();
  while (Date.now() < deadline) {
    url = page.url();
    if (isLoginRedirect(url)) {
      return { status: STATUS.LOGIN_REQUIRED, counts: {}, url };
    }
    text = await page.evaluate(() => document.body.innerText).catch(() => "");
    const counts = parseCounts(text, source.watch);
    if (Object.keys(counts).length > 0) {
      return { status: STATUS.OK, counts, url };
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (isLoginRedirect(url) || /login/i.test(url)) {
    return { status: STATUS.LOGIN_REQUIRED, counts: {}, url };
  }
  if (looksLikeBrokenPage(text, source.watch)) {
    log("探测", source.url, "页面异常", "未在超时内解析到页签计数");
  }
  return { status: STATUS.PAGE_ERROR, counts: {}, url };
}

// 一轮探测同一店铺的所有提醒源，共用一个浏览器，减少启动开销。
async function probeStore(platformKey, store, pageLoadTimeoutMs) {
  const profileDir = resolveStoreProfileDir(platformKey, store.key);
  const session = await openStoreBrowser({
    profileDir,
    targetUrl: store.sources[0] && store.sources[0].url
  });
  try {
    const results = {};
    for (const source of store.sources) {
      const page = await session.context.newPage();
      try {
        results[source.key] = await probeSource(page, source, pageLoadTimeoutMs);
        log("探测", `${store.displayName}/${source.key}`, results[source.key].status, JSON.stringify(results[source.key].counts));
      } catch (error) {
        log("探测", `${store.displayName}/${source.key}`, "异常", error.message);
        results[source.key] = { status: STATUS.PAGE_ERROR, counts: {}, error: error.message };
      } finally {
        await page.close().catch(() => {});
      }
    }
    return results;
  } finally {
    await session.close();
  }
}

module.exports = { probeStore, probeSource };
