// 该文件只负责读取和改变抖音店铺菜单状态，不负责解析店铺身份。
const { DOUYIN_POLL_INTERVAL_MS } = require("./douyinDownloadSettings");
const { runAfterDismissingBlockingPopups } = require("../../../shared/blockingPopupEngine");

async function runDouyinMerchantStoreAction(page, action) {
  // 该函数只保证商家首页上的一次菜单动作不会被明确可关闭的营销弹窗阻断。
  return runAfterDismissingBlockingPopups(page, action, { platformName: "抖音商家首页" });
}

async function findVisibleDouyinSwitchStoreEntries(page) {
  // 该函数只读取当前真实可见的切店入口，不假定上一步留下的菜单仍然展开。
  const switchEntries = page.getByText("切换组织/店铺", { exact: true });
  const visibleSwitchEntries = [];
  for (let index = 0; index < await switchEntries.count(); index += 1) {
    const candidateEntry = switchEntries.nth(index);
    if (await candidateEntry.isVisible().catch(() => false)) {
      visibleSwitchEntries.push(candidateEntry);
    }
  }
  return visibleSwitchEntries;
}

async function waitForOnlyVisibleDouyinSwitchStoreEntry(page, timeoutMs = 10000) {
  // 该函数只等待菜单动画完成，并要求最终只有一个可见切店入口。
  const deadline = Date.now() + timeoutMs;
  let visibleSwitchEntries = [];
  while (Date.now() <= deadline) {
    visibleSwitchEntries = await findVisibleDouyinSwitchStoreEntries(page);
    if (visibleSwitchEntries.length === 1) {
      return visibleSwitchEntries[0];
    }
    if (visibleSwitchEntries.length > 1) {
      break;
    }
    await page.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  throw new Error(`抖音切店入口不唯一：识别到 ${visibleSwitchEntries.length} 个可见“切换组织/店铺”。`);
}

async function ensureDouyinStoreMenuOpenWithoutPopupHandling(page, existingShopHeader = null) {
  // 该函数只按当前菜单状态完成一次“必要时展开并等待入口”动作。
  const visibleSwitchEntries = await findVisibleDouyinSwitchStoreEntries(page);
  if (visibleSwitchEntries.length === 1) {
    return visibleSwitchEntries[0];
  }
  if (visibleSwitchEntries.length > 1) {
    throw new Error(`抖音切店入口不唯一：识别到 ${visibleSwitchEntries.length} 个可见“切换组织/店铺”。`);
  }

  const shopHeader = existingShopHeader || page.locator(".headerShopName").first();
  await shopHeader.waitFor({ state: "visible", timeout: 15000 });
  await shopHeader.click({ timeout: 5000 });
  return waitForOnlyVisibleDouyinSwitchStoreEntry(page);
}

async function ensureDouyinStoreMenuOpen(page, existingShopHeader = null) {
  // 该函数只把菜单状态转换包在弹窗恢复边界内。
  return runDouyinMerchantStoreAction(
    page,
    () => ensureDouyinStoreMenuOpenWithoutPopupHandling(page, existingShopHeader)
  );
}

async function clickDouyinSwitchStoreEntry(page) {
  // 该函数只确认菜单并点击唯一的“切换组织/店铺”入口。
  await runDouyinMerchantStoreAction(
    page,
    async () => {
      const switchStoreEntry = await ensureDouyinStoreMenuOpenWithoutPopupHandling(page);
      await switchStoreEntry.click({ timeout: 5000, noWaitAfter: true });
    }
  );
}

async function findExactDouyinStoreOption(page, expectedStoreName) {
  // 该函数只按完整店名唯一定位可点击项，不依赖店铺身份对象。
  const candidates = page.getByText(expectedStoreName, { exact: true });
  const visibleCandidates = [];
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible() || await candidate.isDisabled().catch(() => false)) {
      continue;
    }
    visibleCandidates.push(candidate);
  }
  return visibleCandidates.length === 1 ? visibleCandidates[0] : null;
}

async function findExactDouyinStoreOptionAcrossPages(originPage, expectedStoreName, timeoutMs = 10000) {
  // 该函数只在当前页和新打开页中有限等待唯一完整店名。
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    for (const candidatePage of originPage.context().pages()) {
      const option = await findExactDouyinStoreOption(candidatePage, expectedStoreName);
      if (option) {
        return { page: candidatePage, option };
      }
    }
    await originPage.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  return null;
}

async function clickDouyinStoreOption(page, storeOption, expectedStoreName = "") {
  // 该函数只重新定位并点击唯一目标店铺选项；店铺选择窗口本身不是遮挡弹窗，不能被通用治理关闭。
  const currentStoreOption = expectedStoreName
    ? await findExactDouyinStoreOption(page, expectedStoreName)
    : storeOption;
  if (!currentStoreOption) {
    throw new Error(`抖音目标店铺选项暂不可点击：${expectedStoreName || "未提供店铺名称"}。`);
  }
  await currentStoreOption.click({ timeout: 10000 });
}

module.exports = {
  runDouyinMerchantStoreAction,
  findVisibleDouyinSwitchStoreEntries,
  waitForOnlyVisibleDouyinSwitchStoreEntry,
  ensureDouyinStoreMenuOpen,
  clickDouyinSwitchStoreEntry,
  findExactDouyinStoreOption,
  findExactDouyinStoreOptionAcrossPages,
  clickDouyinStoreOption
};
