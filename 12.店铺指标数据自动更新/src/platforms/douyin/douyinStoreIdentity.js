const appConfig = require("../../config/appConfig");
const { runAfterDismissingBlockingPopups } = require("../../shared/blockingPopupEngine");

const DOUYIN_POLL_INTERVAL_MS = appConfig.douyin.pageReadyPollIntervalMs;
const DOUYIN_STORE_SWITCH_TIMEOUT_MS = appConfig.douyin.storeSwitchTimeoutMs;
const DOUYIN_BLOCKING_POPUP_OPTIONS = {
  platformName: "抖音商家首页",
  // 抖店首页会动态插入活动/到货类弹窗，实际结构没有 role=dialog，
  // 但该容器会覆盖切店选项，必须纳入安全弹窗治理。
  // 只扫描抖店已知的业务弹窗，不扫描正常的“请选择店铺”业务窗口；
  // 后者也可能使用 role=dialog，但不能被当成遮挡弹窗关闭。
  dialogSelectors: [".ws-arrival-modal"],
  additionalCloseSelectors: [
    "button:has-text('我知道了')",
    "[role='button']:has-text('我知道了')",
    "[aria-label='关闭']",
    "[aria-label='Close' i]",
    ".auxo-modal-close"
  ],
  closeTexts: ["我知道了", "关闭", "取消", "知道了"]
};

async function runDouyinMerchantStoreAction(page, action) {
  return runAfterDismissingBlockingPopups(page, action, DOUYIN_BLOCKING_POPUP_OPTIONS);
}

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
  const storeNameCandidates = shopHeader.locator(':scope > [data-bytereplay-mask="true"]');
  const visibleStoreNameCandidates = [];
  for (let index = 0; index < await storeNameCandidates.count(); index += 1) {
    const candidate = storeNameCandidates.nth(index);
    if (await candidate.isVisible().catch(() => false)) visibleStoreNameCandidates.push(candidate);
  }
  if (visibleStoreNameCandidates.length !== 1) {
    throw new Error(`读取抖音当前店铺名称失败：顶部识别到 ${visibleStoreNameCandidates.length} 个可见纯店名节点。`);
  }
  const storeName = (await visibleStoreNameCandidates[0].innerText()).replace(/\s+/g, " ").trim();
  if (!storeName) throw new Error("读取抖音当前店铺名称失败：顶部纯店名为空。");
  return storeName;
}

async function findVisibleDouyinSwitchStoreEntries(page) {
  const switchEntries = page.getByText("切换组织/店铺", { exact: true });
  const visibleSwitchEntries = [];
  for (let index = 0; index < await switchEntries.count(); index += 1) {
    const candidateEntry = switchEntries.nth(index);
    if (await candidateEntry.isVisible().catch(() => false)) visibleSwitchEntries.push(candidateEntry);
  }
  return visibleSwitchEntries;
}

async function waitForOnlyVisibleDouyinSwitchStoreEntry(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let visibleSwitchEntries = [];
  while (Date.now() <= deadline) {
    visibleSwitchEntries = await findVisibleDouyinSwitchStoreEntries(page);
    if (visibleSwitchEntries.length === 1) return visibleSwitchEntries[0];
    if (visibleSwitchEntries.length > 1) break;
    await page.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  throw new Error(`抖音切店入口不唯一：识别到 ${visibleSwitchEntries.length} 个可见“切换组织/店铺”。`);
}

async function ensureDouyinStoreMenuOpenWithoutPopupHandling(page, existingShopHeader = null) {
  const visibleSwitchEntries = await findVisibleDouyinSwitchStoreEntries(page);
  if (visibleSwitchEntries.length === 1) return visibleSwitchEntries[0];
  if (visibleSwitchEntries.length > 1) {
    throw new Error(`抖音切店入口不唯一：识别到 ${visibleSwitchEntries.length} 个可见“切换组织/店铺”。`);
  }
  const shopHeader = existingShopHeader || page.locator(".headerShopName").first();
  await shopHeader.waitFor({ state: "visible", timeout: 15000 });
  await shopHeader.click({ timeout: 5000 });
  return waitForOnlyVisibleDouyinSwitchStoreEntry(page);
}

async function ensureDouyinStoreMenuOpen(page, existingShopHeader = null) {
  return runDouyinMerchantStoreAction(
    page,
    () => ensureDouyinStoreMenuOpenWithoutPopupHandling(page, existingShopHeader)
  );
}

async function clickDouyinSwitchStoreEntry(page) {
  await runDouyinMerchantStoreAction(
    page,
    async () => {
      const switchStoreEntry = await ensureDouyinStoreMenuOpenWithoutPopupHandling(page);
      await switchStoreEntry.click({ timeout: 5000, noWaitAfter: true });
    }
  );
}

async function readCurrentDouyinStoreIdentity(page) {
  const shopHeader = page.locator(".headerShopName").first();
  await shopHeader.waitFor({ state: "visible", timeout: 15000 });
  const storeName = await readDouyinStoreName(shopHeader);
  await ensureDouyinStoreMenuOpen(page, shopHeader);
  const pageText = await page.locator("body").innerText({ timeout: 5000 });
  const storeIdMatches = [...pageText.matchAll(/店铺ID\s*(\d+)/g)].map((match) => match[1]);
  const uniqueStoreIds = [...new Set(storeIdMatches)];
  if (uniqueStoreIds.length !== 1) {
    throw new Error(`读取抖音当前店铺 ID 失败：店铺菜单内识别到 ${uniqueStoreIds.length} 个店铺 ID。`);
  }
  return { storeId: uniqueStoreIds[0], storeName };
}

async function findExactDouyinStoreOption(page, expectedIdentity) {
  const candidates = page.getByText(expectedIdentity.storeName, { exact: true });
  const visibleCandidates = [];
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false) || await candidate.isDisabled().catch(() => false)) continue;
    visibleCandidates.push(candidate);
  }
  return visibleCandidates.length === 1 ? visibleCandidates[0] : null;
}

async function findExactDouyinStoreOptionAcrossPages(originPage, expectedIdentity, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    for (const candidatePage of originPage.context().pages()) {
      const option = await findExactDouyinStoreOption(candidatePage, expectedIdentity);
      if (option) return { page: candidatePage, option };
    }
    await originPage.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  return null;
}

async function clickDouyinStorePickerOption(storeOption, surface = null) {
  // “请选择店铺”是正常切店业务窗口，不是遮挡弹窗；这里只点击已按完整店名唯一确认的店铺项。
  // 点击前仍治理首页可能晚到的活动弹窗，避免弹窗覆盖唯一店铺选项。
  const clickAction = () => storeOption.click({ timeout: 10000 });
  if (surface) {
    await runDouyinMerchantStoreAction(surface, clickAction);
    return;
  }
  await clickAction();
}

async function waitForExpectedDouyinStore(originPage, expectedIdentity, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastIdentity = null;
  while (Date.now() <= deadline) {
    for (const candidatePage of originPage.context().pages()) {
      const header = candidatePage.locator(".headerShopName").first();
      if ((await header.count()) === 0 || !await header.isVisible().catch(() => false)) continue;
      try {
        lastIdentity = await readCurrentDouyinStoreIdentity(candidatePage);
        if (isDouyinStoreIdentityMatched(lastIdentity, expectedIdentity)) {
          return { page: candidatePage, identity: lastIdentity };
        }
      } catch (_error) {
        // 页面正在切店或刷新时继续等待，最终错误会带出最后一次可读身份。
      }
    }
    await originPage.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  const actualText = lastIdentity ? `${lastIdentity.storeName}(${lastIdentity.storeId})` : "未读取到";
  throw new Error(`等待抖音目标店铺超时：目标=${expectedIdentity.storeName}(${expectedIdentity.storeId})，当前=${actualText}。`);
}

async function ensureDouyinActiveStore(page, storeConfig, reportProgress, options = {}) {
  const expectedIdentity = resolveExpectedDouyinStoreIdentity(storeConfig);
  const currentIdentity = await readCurrentDouyinStoreIdentity(page);
  if (isDouyinStoreIdentityMatched(currentIdentity, expectedIdentity)) {
    return { page, identity: currentIdentity };
  }
  if (typeof reportProgress === "function") {
    reportProgress(
      "切换抖音店铺",
      `当前=${currentIdentity.storeName}(${currentIdentity.storeId})，目标=${expectedIdentity.storeName}(${expectedIdentity.storeId})`
    );
  }
  await clickDouyinSwitchStoreEntry(page);
  await page.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  const exactStoreOption = await findExactDouyinStoreOptionAcrossPages(page, expectedIdentity);
  if (exactStoreOption) {
    // 店铺选择器可能在新页面，但活动弹窗仍挂在原商家首页；
    // 固定用原首页做弹窗治理，再点击已确认的跨页店铺选项。
    await clickDouyinStorePickerOption(exactStoreOption.option, page);
  } else {
    if (typeof reportProgress === "function") {
      reportProgress("等待人工切店", "未找到目标完整店名的唯一可点项，请在当前页面手动切换，程序会自动续跑");
    }
    await page.bringToFront().catch(() => {});
  }
  const timeoutMs = Number(options.storeSwitchTimeoutMs) || DOUYIN_STORE_SWITCH_TIMEOUT_MS;
  return waitForExpectedDouyinStore(page, expectedIdentity, timeoutMs);
}

module.exports = {
  runDouyinMerchantStoreAction,
  DOUYIN_BLOCKING_POPUP_OPTIONS,
  normalizeDouyinStoreName,
  resolveExpectedDouyinStoreIdentity,
  isDouyinStoreIdentityMatched,
  readDouyinStoreName,
  readCurrentDouyinStoreIdentity,
  findVisibleDouyinSwitchStoreEntries,
  waitForOnlyVisibleDouyinSwitchStoreEntry,
  ensureDouyinStoreMenuOpenWithoutPopupHandling,
  ensureDouyinStoreMenuOpen,
  clickDouyinSwitchStoreEntry,
  findExactDouyinStoreOption,
  findExactDouyinStoreOptionAcrossPages,
  clickDouyinStorePickerOption,
  waitForExpectedDouyinStore,
  ensureDouyinActiveStore
};
