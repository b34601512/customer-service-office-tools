const { requireHeadedBrowser } = require("../../../engine/browserAutomationScope");
const { log } = require("../../../engine/logger");
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
  // 2026-09-30（失败台账规律 #1，切店卡死 5 次）：原来 catch 里什么都不留，
  // 卡死时日志只有“超时”，无法定位。现在保留最近错误 + 定期播报（禁止静默等待）。
  let lastError = "";
  let scannedRounds = 0;
  let lastReportAt = Date.now();
  while (Date.now() <= deadline) {
    for (const candidatePage of originPage.context().pages()) {
      try {
        const currentStoreName = await readCurrentDouyinStoreName(candidatePage);
        lastStoreName = currentStoreName;
        lastError = "";
        if (normalizeDouyinStoreName(currentStoreName) !== normalizeDouyinStoreName(expectedIdentity.storeName)) {
          continue;
        }
        await ensureDouyinStoreMenuOpen(candidatePage);
        lastIdentity = await collectCurrentDouyinStoreIdentityFromOpenMenu(candidatePage);
        if (isDouyinStoreIdentityMatched(lastIdentity, expectedIdentity)) {
          return { page: candidatePage, identity: lastIdentity };
        }
      } catch (error) {
        // 页面正在切店或刷新时继续等待，但必须把原因带到最终报错里。
        lastError = String((error && error.message) || error).split("\n")[0];
      }
    }
    scannedRounds += 1;
    if (Date.now() - lastReportAt >= 15000) {
      lastReportAt = Date.now();
      const remainingSeconds = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      log(
        "主线:诊断",
        "抖音下载",
        "等待目标店铺",
        `已轮询${scannedRounds}轮（剩${remainingSeconds}s），当前=${lastStoreName || "未读取到"}${lastError ? `，最近错误=${lastError}` : ""}`
      );
    }
    await originPage.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  const actualText = lastIdentity
    ? `${lastIdentity.storeName}(${lastIdentity.storeId})`
    : lastStoreName || "未读取到";
  throw new Error(`等待抖音目标店铺超时：目标=${expectedIdentity.storeName}(${expectedIdentity.storeId})，当前=${actualText}${lastError ? `，最近读取错误=${lastError}` : ""}。`);
}

async function ensureDouyinActiveStore(page, storeConfig, reportProgress, options = {}) {
  // 已匹配直接返回；不匹配时先精确自动切换，无法精确定位则等待人工切换。
  // 2026-09-30（失败台账规律 #1）：分阶段计时，失败时把阶段表带进报错，一眼看出卡在哪一段。
  const stages = [];
  const runStage = async (name, action) => {
    const startedAt = Date.now();
    try {
      const result = await action();
      stages.push(`${name}=${Date.now() - startedAt}ms`);
      return result;
    } catch (error) {
      stages.push(`${name}=失败(${Date.now() - startedAt}ms)`);
      error.message = `${error.message}｜切店阶段：${stages.join("，")}`;
      throw error;
    }
  };
  const expectedIdentity = resolveExpectedDouyinStoreIdentity(storeConfig);
  const currentIdentity = await runStage("读取当前身份", () => ensureDouyinStoreMenuAndCollectCurrentIdentity(page));
  if (isDouyinStoreIdentityMatched(currentIdentity, expectedIdentity)) {
    return { page, identity: currentIdentity };
  }

  reportProgress(
    "切换抖音店铺",
    `当前=${currentIdentity.storeName}(${currentIdentity.storeId})，目标=${expectedIdentity.storeName}(${expectedIdentity.storeId})`
  );
  await runStage("点击切店入口", () => clickDouyinSwitchStoreEntry(page));
  const exactStoreOption = await runStage(
    "查找店铺选项",
    () => findExactDouyinStoreOptionAcrossPages(page, expectedIdentity.storeName)
  );
  if (exactStoreOption) {
    await runStage(
      "点击店铺选项",
      () => clickDouyinStoreOption(exactStoreOption.page, exactStoreOption.option, expectedIdentity.storeName)
    );
  } else {
    requireHeadedBrowser("抖音需要人工确认目标店铺");
    reportProgress("等待人工切店", "未找到目标完整店名的唯一可点项，请在当前页面手动切换，程序会自动续跑");
    await page.bringToFront();
  }

  const timeoutMs = Number(options.storeSwitchTimeoutMs) || DOUYIN_STORE_SWITCH_TIMEOUT_MS;
  return runStage("等待目标店铺", () => waitForExpectedDouyinStore(page, expectedIdentity, timeoutMs));
}

module.exports = {
  ensureDouyinStoreMenuAndCollectCurrentIdentity,
  waitForExpectedDouyinStore,
  ensureDouyinActiveStore
};
