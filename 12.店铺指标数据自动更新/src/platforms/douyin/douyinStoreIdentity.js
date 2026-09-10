const appConfig = require("../../config/appConfig");
const { runAfterDismissingBlockingPopups } = require("../../shared/blockingPopupEngine");
const { requireHeadedBrowser } = require("../../engine/browserAutomationScope");

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

function reportDouyinProgress(reportProgress, stage, detail) {
  if (typeof reportProgress === "function") reportProgress(stage, detail);
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

async function isDouyinStoreMenuIdentityVisible(page) {
  const pageText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  return /店铺\s*ID\s*[:：]?\s*\d+/i.test(String(pageText || ""));
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
  // 人工登录后的 SPA 可能先显示店铺标题、稍后才挂载菜单点击逻辑；有限重试同一安全入口，避免把加载竞态误判成未登录。
  let visibleSwitchEntries = await findVisibleDouyinSwitchStoreEntries(page);
  if (visibleSwitchEntries.length === 1) return visibleSwitchEntries[0];
  if (visibleSwitchEntries.length > 1) {
    throw new Error(`抖音切店入口不唯一：识别到 ${visibleSwitchEntries.length} 个可见“切换组织/店铺”。`);
  }

  const shopHeader = existingShopHeader || page.locator(".headerShopName").first();
  await shopHeader.waitFor({ state: "visible", timeout: 15000 });

  const deadline = Date.now() + 12000;
  let clickAttempts = 0;
  let menuIdentitySeen = false;
  while (Date.now() <= deadline) {
    visibleSwitchEntries = await findVisibleDouyinSwitchStoreEntries(page);
    if (visibleSwitchEntries.length === 1) return visibleSwitchEntries[0];
    if (visibleSwitchEntries.length > 1) {
      throw new Error(`抖音切店入口不唯一：识别到 ${visibleSwitchEntries.length} 个可见“切换组织/店铺”。`);
    }

    menuIdentitySeen = menuIdentitySeen || await isDouyinStoreMenuIdentityVisible(page);
    if (!menuIdentitySeen) {
      await shopHeader.click({ timeout: 5000, noWaitAfter: true });
      clickAttempts += 1;
    }

    const settleDeadline = Math.min(
      deadline,
      Date.now() + Math.max(2000, DOUYIN_POLL_INTERVAL_MS * 2)
    );
    while (Date.now() <= settleDeadline) {
      visibleSwitchEntries = await findVisibleDouyinSwitchStoreEntries(page);
      if (visibleSwitchEntries.length === 1) return visibleSwitchEntries[0];
      if (visibleSwitchEntries.length > 1) {
        throw new Error(`抖音切店入口不唯一：识别到 ${visibleSwitchEntries.length} 个可见“切换组织/店铺”。`);
      }
      menuIdentitySeen = menuIdentitySeen || await isDouyinStoreMenuIdentityVisible(page);
      await page.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
    }

    if (menuIdentitySeen) await page.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }

  const detail = menuIdentitySeen
    ? "店铺菜单已展开并读取到店铺ID，但未出现唯一的“切换组织/店铺”入口，可能是入口文案或DOM结构发生变化。"
    : `店铺头部已可见，但连续 ${clickAttempts} 次尝试后菜单仍未展开，可能仍处于登录后页面初始化状态。`;
  throw new Error(`抖音切店入口不唯一：识别到 0 个可见“切换组织/店铺”。${detail}`);
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
  const storeId = await waitForDouyinStoreIdInOpenMenu(page);
  return { storeId, storeName };
}

function extractDouyinStoreIdsFromText(pageText) {
  const normalizedPageText = String(pageText || "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  return [...normalizedPageText.matchAll(/店铺\s*ID\s*[:：]?\s*(\d+)/gi)].map((match) => match[1]);
}

async function readDouyinStoreIdFromOpenMenu(page) {
  const pageText = await page.locator("body").innerText({ timeout: 5000 });
  const uniqueStoreIds = [...new Set(extractDouyinStoreIdsFromText(pageText))];
  if (uniqueStoreIds.length !== 1) {
    throw new Error(`读取抖音当前店铺 ID 失败：店铺菜单内识别到 ${uniqueStoreIds.length} 个店铺 ID。`);
  }
  return uniqueStoreIds[0];
}

async function waitForDouyinStoreIdInOpenMenu(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      return await readDouyinStoreIdFromOpenMenu(page);
    } catch (error) {
      lastError = error;
      if (!String(error?.message || "").includes("识别到 0 个店铺 ID")) throw error;
    }
    await page.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  throw lastError || new Error("读取抖音当前店铺 ID 失败：等待店铺菜单身份文本超时。");
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

async function clickDouyinStorePickerOption(storeOption) {
  // “请选择店铺”是正常业务窗口，已按完整店名唯一定位后直接点击。
  await storeOption.click({ timeout: 10000 });
}

async function waitForExpectedDouyinStore(originPage, expectedIdentity, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastIdentity = null;
  let lastStoreName = "";
  while (Date.now() <= deadline) {
    for (const candidatePage of originPage.context().pages()) {
      const header = candidatePage.locator(".headerShopName").first();
      if ((await header.count()) === 0 || !await header.isVisible().catch(() => false)) continue;
      try {
        const storeName = await readDouyinStoreName(header);
        lastStoreName = storeName;
        if (normalizeDouyinStoreName(storeName) !== normalizeDouyinStoreName(expectedIdentity.storeName)) {
          continue;
        }
        await ensureDouyinStoreMenuOpen(candidatePage, header);
        const storeId = await waitForDouyinStoreIdInOpenMenu(candidatePage);
        lastIdentity = { storeName, storeId };
        if (isDouyinStoreIdentityMatched(lastIdentity, expectedIdentity)) {
          return { page: candidatePage, identity: lastIdentity };
        }
      } catch (_error) {
        // 页面正在切店或刷新时继续等待，最终错误会带出最后一次可读身份。
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
  const expectedIdentity = resolveExpectedDouyinStoreIdentity(storeConfig);
  const currentIdentity = await readCurrentDouyinStoreIdentity(page);
  if (isDouyinStoreIdentityMatched(currentIdentity, expectedIdentity)) {
    return { page, identity: currentIdentity };
  }
  reportDouyinProgress(
    reportProgress,
    "切换抖音店铺",
    `当前=${currentIdentity.storeName}(${currentIdentity.storeId})，目标=${expectedIdentity.storeName}(${expectedIdentity.storeId})`
  );
  await clickDouyinSwitchStoreEntry(page);
  reportDouyinProgress(reportProgress, "定位目标店铺", `正在查找${expectedIdentity.storeName}`);
  const exactStoreOption = await findExactDouyinStoreOptionAcrossPages(page, expectedIdentity);
  if (exactStoreOption) {
    reportDouyinProgress(reportProgress, "点击目标店铺", `已定位${expectedIdentity.storeName}`);
    await clickDouyinStorePickerOption(exactStoreOption.option);
    reportDouyinProgress(reportProgress, "确认店铺切换", `等待${expectedIdentity.storeName}生效`);
  } else {
    if (options.headless) {
      requireHeadedBrowser("抖音需要人工确认目标店铺");
    }
    reportDouyinProgress(reportProgress, "等待人工切店", "未找到目标店铺，请在当前页面手动切换");
    await page.bringToFront().catch(() => {});
  }
  const timeoutMs = Number(options.storeSwitchTimeoutMs) || DOUYIN_STORE_SWITCH_TIMEOUT_MS;
  try {
    const result = await waitForExpectedDouyinStore(page, expectedIdentity, timeoutMs);
    reportDouyinProgress(
      reportProgress,
      "切店完成",
      `当前=${result.identity.storeName}(${result.identity.storeId})`
    );
    return result;
  } catch (error) {
    if (options.headless) {
      requireHeadedBrowser("抖音需要人工确认目标店铺");
    }
    throw error;
  }
}

module.exports = {
  runDouyinMerchantStoreAction,
  DOUYIN_BLOCKING_POPUP_OPTIONS,
  normalizeDouyinStoreName,
  resolveExpectedDouyinStoreIdentity,
  isDouyinStoreIdentityMatched,
  readDouyinStoreName,
  extractDouyinStoreIdsFromText,
  readDouyinStoreIdFromOpenMenu,
  waitForDouyinStoreIdInOpenMenu,
  readCurrentDouyinStoreIdentity,
  findVisibleDouyinSwitchStoreEntries,
  isDouyinStoreMenuIdentityVisible,
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
