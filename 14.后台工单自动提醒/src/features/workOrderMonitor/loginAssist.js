// 本文件是登录辅助业务动作：拉起带店铺 profile 的可见 Chrome，人工登录一次即可长期复用。
const { openStoreBrowser, resolveStoreProfileDir } = require("../../engine/chromeSession");
const { loadConfig } = require("../../config/projectConfigService");
const { log } = require("../../engine/logger");

async function loginAssist(storeKey) {
  const config = loadConfig();
  let target = null;
  let platformKey = null;
  for (const [pk, platform] of Object.entries(config.platforms)) {
    const store = (platform.stores || []).find((s) => s.key === storeKey);
    if (store) {
      target = store;
      platformKey = pk;
      break;
    }
  }
  if (!target) {
    const keys = Object.values(config.platforms).flatMap((p) => (p.stores || []).map((s) => s.key));
    throw new Error(`未找到店铺 ${storeKey}，现有店铺：${keys.join("、")}`);
  }
  const firstUrl = target.sources[0].url;
  log("登录辅助", target.displayName, "拉起浏览器", `账号提示：${target.username}`);
  const session = await openStoreBrowser({
    profileDir: resolveStoreProfileDir(platformKey, target.key),
    targetUrl: firstUrl
  });
  return {
    store: target,
    async close() {
      await session.close();
    }
  };
}

module.exports = { loginAssist };
