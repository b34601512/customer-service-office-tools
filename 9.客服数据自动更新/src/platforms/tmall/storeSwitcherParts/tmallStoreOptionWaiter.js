// 该文件用于解决天猫目标店铺候选采集和等待问题。
const appConfig = require("../../../config/appConfig");
const {
  normalizeInlineText,
  buildTmallStoreOptionPattern
} = require("./tmallStoreNameText");
const {
  selectBestTmallStoreOptionSnapshot,
  describeTmallStoreOptionSnapshots
} = require("./tmallStoreOptionScoring");

const TMALL_STORE_OPTION_SELECTOR = "li, a, button, [role='option'], [role='menuitem'], div, span";
const TMALL_STORE_OPTION_POLL_INTERVAL_MS = appConfig.tmall.storeOptionPollIntervalMs;

async function collectTmallStoreOptionSnapshots(page, expectedShopNames) {
  // 这里统一采集候选店铺节点快照，后续筛选、点击和报错都共用同一份事实依据。
  const optionPattern = buildTmallStoreOptionPattern(expectedShopNames);
  const optionCandidates = page.locator(TMALL_STORE_OPTION_SELECTOR).filter({ hasText: optionPattern });
  const count = await optionCandidates.count();
  const snapshots = [];

  for (let index = 0; index < count; index += 1) {
    const locator = optionCandidates.nth(index);
    const text = normalizeInlineText(await locator.innerText());
    const visible = await locator.isVisible();
    const disabled = await locator.isDisabled();
    const box = await locator.boundingBox();
    const tagName = await locator.evaluate((element) => element.tagName);
    snapshots.push({
      index,
      text,
      visible,
      disabled,
      tagName,
      area: box ? Math.round(box.width * box.height) : 0
    });
  }

  return {
    optionCandidates,
    snapshots
  };
}

async function waitForVisibleTmallStoreOption(page, expectedShopNames, timeoutMs = 10000) {
  // 这里按状态轮询目标店铺选项，直到真正出现可点候选，不再死等某个固定索引的节点变可见。
  const deadline = Date.now() + timeoutMs;
  let lastSnapshots = [];

  while (Date.now() <= deadline) {
    const { optionCandidates, snapshots } = await collectTmallStoreOptionSnapshots(page, expectedShopNames);
    lastSnapshots = snapshots;
    const bestSnapshot = selectBestTmallStoreOptionSnapshot(snapshots, expectedShopNames);
    if (bestSnapshot) {
      return {
        locator: optionCandidates.nth(bestSnapshot.index),
        bestSnapshot,
        snapshots
      };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(TMALL_STORE_OPTION_POLL_INTERVAL_MS, remainingMs)));
  }

  throw new Error(
    `等待目标店铺选项可见超时：目标=${expectedShopNames.join("/")}；候选=${describeTmallStoreOptionSnapshots(lastSnapshots)}。`
  );
}

module.exports = {
  waitForVisibleTmallStoreOption
};
