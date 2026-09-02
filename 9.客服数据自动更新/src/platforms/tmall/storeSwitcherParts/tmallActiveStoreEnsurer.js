// 该文件用于解决天猫已登录页面切换到目标店铺的问题。
const { log } = require("../../../engine/logger");
const { clickTmallControlWhenReady } = require("../tmallControls");
const {
  resolveExpectedTmallShopNames,
  isExpectedTmallShop
} = require("./tmallStoreNameText");
const { describeTmallStoreOptionSnapshots } = require("./tmallStoreOptionScoring");
const {
  readCurrentTmallShopName,
  waitForExpectedShop
} = require("./tmallCurrentShopReader");
const { waitForVisibleTmallStoreOption } = require("./tmallStoreOptionWaiter");

async function ensureTmallActiveStore(page, storeConfig) {
  // 这里在已登录前提下强制校验当前浏览器店铺，不对就先切店，避免下载错店数据。
  const expectedShopNames = resolveExpectedTmallShopNames(storeConfig);
  if (expectedShopNames.length === 0) {
    throw new Error("当前店铺缺少可识别的天猫店铺名，请把账号字段写成“店铺名:账号人”格式。");
  }

  const currentShopName = await readCurrentTmallShopName(page);
  if (isExpectedTmallShop(currentShopName, expectedShopNames)) {
    log(
      "主线:完成",
      "天猫切店",
      "店铺校验",
      `当前浏览器店铺已匹配，当前=${currentShopName}，目标=${expectedShopNames.join("/")}`
    );
    return currentShopName;
  }

  log(
    "主线:执行",
    "天猫切店",
    "店铺切换",
    `当前=${currentShopName}，目标=${expectedShopNames.join("/")}`
  );

  const switchTrigger = page.locator("a[class*='Frame-module-header']").first();
  await clickTmallControlWhenReady(switchTrigger, "店铺切换入口", 10000);

  log("主线:等待", "天猫切店", "店铺候选", `等待目标店铺选项出现，目标=${expectedShopNames.join("/")}`);
  const { locator: option, bestSnapshot, snapshots } = await waitForVisibleTmallStoreOption(page, expectedShopNames, 10000);
  log(
    "主线:完成",
    "天猫切店",
    "店铺候选",
    `已命中候选=${bestSnapshot.tagName || "UNKNOWN"} 文本=${bestSnapshot.text || "空文本"}；候选概览=${describeTmallStoreOptionSnapshots(snapshots)}`
  );
  await clickTmallControlWhenReady(option, `目标店铺选项(${bestSnapshot.text || "空文本"})`, 10000);

  const switchedShopName = await waitForExpectedShop(page, expectedShopNames);
  log(
    "主线:完成",
    "天猫切店",
    "店铺切换",
    `已切到目标店铺，当前=${switchedShopName}，目标=${expectedShopNames.join("/")}`
  );
  return switchedShopName;
}

module.exports = {
  ensureTmallActiveStore
};
