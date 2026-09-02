// 该文件只负责把身份读取、菜单操作和切店验收组合成抖音店铺状态流程。
const {
  DOUYIN_POLL_INTERVAL_MS,
  DOUYIN_STORE_SWITCH_TIMEOUT_MS
} = require("./douyinDownloadSettings");
const {
  normalizeDouyinStoreName,
  resolveExpectedDouyinStoreIdentity,
  isDouyinStoreIdentityMatched,
  readCurrentDouyinStoreName,
  collectCurrentDouyinStoreIdentityFromOpenMenu
} = require("./douyinStoreIdentity");
const {
  ensureDouyinStoreMenuOpen,
  clickDouyinSwitchStoreEntry,
  findExactDouyinStoreOptionAcrossPages,
  clickDouyinStoreOption
} = require("./douyinStoreMenu");

async function ensureDouyinStoreMenuAndCollectCurrentIdentity(page) {
  // 该函数只组合“打开菜单”和“读取菜单身份”，两个底层动作仍保持独立。
  await ensureDouyinStoreMenuOpen(page);
  return collectCurrentDouyinStoreIdentityFromOpenMenu(page);
}

async function waitForExpectedDouyinStore(originPage, expectedIdentity, timeoutMs) {
  // 自动切换未命中时保留页面给人工操作，并持续用 ID+名称双重确认。
  const deadline = Date.now() + timeoutMs;
  let lastIdentity = null;
  let lastStoreName = "";
  while (Date.now() <= deadline) {
    for (const candidatePage of originPage.context().pages()) {
      try {
        const currentStoreName = await readCurrentDouyinStoreName(candidatePage);
        lastStoreName = currentStoreName;
        if (normalizeDouyinStoreName(currentStoreName) !== normalizeDouyinStoreName(expectedIdentity.storeName)) {
          continue;
        }
        await ensureDouyinStoreMenuOpen(candidatePage);
        lastIdentity = await collectCurrentDouyinStoreIdentityFromOpenMenu(candidatePage);
        if (isDouyinStoreIdentityMatched(lastIdentity, expectedIdentity)) {
          return { page: candidatePage, identity: lastIdentity };
        }
      } catch (_error) {
        // 页面正在切店或刷新时继续等待，最终报错会带最后一次可读身份。
      }
    }
    await originPage.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  const actualText = lastIdentity
    ? `${lastIdentity.storeName}(${lastIdentity.storeId})`
    : lastStoreName || "未读取到";
  throw new Error(`等待抖音目标店铺超时：目标=${expectedIdentity.storeName}(${expectedIdentity.storeId})，当前=${actualText}。`);
}

async function ensureDouyinActiveStore(page, storeConfig, reportProgress, options = {}) {
  // 已匹配直接返回；不匹配时先精确自动切换，无法精确定位则等待人工切换。
  const expectedIdentity = resolveExpectedDouyinStoreIdentity(storeConfig);
  const currentIdentity = await ensureDouyinStoreMenuAndCollectCurrentIdentity(page);
  if (isDouyinStoreIdentityMatched(currentIdentity, expectedIdentity)) {
    return { page, identity: currentIdentity };
  }

  reportProgress(
    "切换抖音店铺",
    `当前=${currentIdentity.storeName}(${currentIdentity.storeId})，目标=${expectedIdentity.storeName}(${expectedIdentity.storeId})`
  );
  await clickDouyinSwitchStoreEntry(page);
  const exactStoreOption = await findExactDouyinStoreOptionAcrossPages(page, expectedIdentity.storeName);
  if (exactStoreOption) {
    await clickDouyinStoreOption(exactStoreOption.page, exactStoreOption.option, expectedIdentity.storeName);
  } else {
    reportProgress("等待人工切店", "未找到目标完整店名的唯一可点项，请在当前页面手动切换，程序会自动续跑");
    await page.bringToFront();
  }

  const timeoutMs = Number(options.storeSwitchTimeoutMs) || DOUYIN_STORE_SWITCH_TIMEOUT_MS;
  return waitForExpectedDouyinStore(page, expectedIdentity, timeoutMs);
}

module.exports = {
  ensureDouyinStoreMenuAndCollectCurrentIdentity,
  waitForExpectedDouyinStore,
  ensureDouyinActiveStore
};
