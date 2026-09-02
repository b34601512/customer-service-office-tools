// 该文件只负责解析抖音店铺身份，不负责打开菜单或点击切店控件。
const {
  DOUYIN_POLL_INTERVAL_MS,
  DOUYIN_STORE_ID_READ_TIMEOUT_MS
} = require("./douyinDownloadSettings");

function normalizeDouyinStoreName(value) {
  return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
}

function resolveExpectedDouyinStoreIdentity(storeConfig) {
  const storeId = String(storeConfig?.platformStoreId || "").replace(/\D/g, "");
  const storeName = String(storeConfig?.platformStoreName || "").replace(/\s+/g, " ").trim();
  if (!storeId || !storeName) {
    throw new Error(
      `抖音店铺「${storeConfig?.displayName || storeConfig?.key || "未知店铺"}」尚未绑定平台店铺 ID 和名称，请先在配置页按商家后台顶部信息填写。`
    );
  }
  return { storeId, storeName };
}

function isDouyinStoreIdentityMatched(actualIdentity, expectedIdentity) {
  return String(actualIdentity?.storeId || "") === String(expectedIdentity?.storeId || "") &&
    normalizeDouyinStoreName(actualIdentity?.storeName) === normalizeDouyinStoreName(expectedIdentity?.storeName);
}

async function readDouyinStoreName(shopHeader) {
  // 实采：弹层展开后 headerShopName 会混入整层菜单文本，纯店名位于带脱敏标记的直接子节点。
  const storeNameCandidates = shopHeader.locator(':scope > [data-bytereplay-mask="true"]');
  const visibleStoreNameCandidates = [];
  for (let index = 0; index < await storeNameCandidates.count(); index += 1) {
    const candidate = storeNameCandidates.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      visibleStoreNameCandidates.push(candidate);
    }
  }
  if (visibleStoreNameCandidates.length !== 1) {
    throw new Error(`读取抖音当前店铺名称失败：顶部识别到 ${visibleStoreNameCandidates.length} 个可见纯店名节点。`);
  }
  const storeName = (await visibleStoreNameCandidates[0].innerText()).replace(/\s+/g, " ").trim();
  if (!storeName) {
    throw new Error("读取抖音当前店铺名称失败：顶部纯店名为空。");
  }
  return storeName;
}

async function readCurrentDouyinStoreName(page) {
  // 该函数只读取当前页面顶部纯店名，不改变页面菜单状态。
  const shopHeader = page.locator(".headerShopName").first();
  await shopHeader.waitFor({ state: "visible", timeout: 15000 });
  return readDouyinStoreName(shopHeader);
}

function extractDouyinStoreIdsFromText(pageText) {
  // 抖音页面实际排版可能是“店铺ID 123”“店铺 ID\n123”或“店铺ID：123”。
  const normalizedPageText = String(pageText || "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  return [...normalizedPageText.matchAll(/店铺\s*ID\s*[:：]?\s*(\d+)/gi)].map((match) => match[1]);
}

async function readDouyinStoreIdFromOpenMenu(page) {
  // 该函数只读取已经打开的店铺菜单文本，调用方必须先完成菜单状态转换。
  const pageText = await page.locator("body").innerText({ timeout: 5000 });
  const uniqueStoreIds = [...new Set(extractDouyinStoreIdsFromText(pageText))];
  if (uniqueStoreIds.length !== 1) {
    throw new Error(`读取抖音当前店铺 ID 失败：店铺菜单内识别到 ${uniqueStoreIds.length} 个店铺 ID。`);
  }
  return uniqueStoreIds[0];
}

async function waitForDouyinStoreIdInOpenMenu(page, timeoutMs = DOUYIN_STORE_ID_READ_TIMEOUT_MS) {
  // 该函数只等待已经打开菜单中的店铺 ID 出现，不改变菜单状态。
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      return await readDouyinStoreIdFromOpenMenu(page);
    } catch (error) {
      lastError = error;
      if (!String(error?.message || "").includes("识别到 0 个店铺 ID")) {
        throw error;
      }
    }
    await page.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  throw lastError || new Error("读取抖音当前店铺 ID 失败：等待店铺菜单身份文本超时。");
}

async function collectCurrentDouyinStoreIdentityFromOpenMenu(page) {
  // 该函数只组合两个无副作用读取动作，仍不负责打开或关闭菜单。
  const storeName = await readCurrentDouyinStoreName(page);
  const storeId = await waitForDouyinStoreIdInOpenMenu(page);
  return { storeId, storeName };
}

module.exports = {
  normalizeDouyinStoreName,
  resolveExpectedDouyinStoreIdentity,
  isDouyinStoreIdentityMatched,
  readDouyinStoreName,
  extractDouyinStoreIdsFromText,
  readCurrentDouyinStoreName,
  readDouyinStoreIdFromOpenMenu,
  waitForDouyinStoreIdInOpenMenu,
  collectCurrentDouyinStoreIdentityFromOpenMenu
};
