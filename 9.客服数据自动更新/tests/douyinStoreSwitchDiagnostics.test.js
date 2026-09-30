// 反向断言（2026-09-30 失败台账规律 #1「抖音切店/身份确认」5 次）：
// 切店等待超时时必须把「最近一次读取失败原因」带进报错——原来 catch 里什么都不留，
// 卡死时日志只有“超时”二字，现场全靠猜（09-30 店铺5 卡死 480s）。
const assert = require("node:assert");
const { waitForExpectedDouyinStore } = require("../src/platforms/douyin/downloadTaskParts/douyinStoreSwitcher");

function makeList(items) {
  return { count: async () => items.length, nth: (index) => items[index] };
}

/** 顶部头部永远读不到纯店名（模拟页面正在切店/刷新）→ readCurrentDouyinStoreName 必抛错。 */
function makeUnreadablePage() {
  const header = {
    waitFor: async () => {},
    locator: () => makeList([])
  };
  const page = {
    url: () => "https://fxg.jinritemai.com/ffa/mshop/homepage/index",
    locator: (selector) => (selector === '[class*="headerShopName"]' ? { first: () => header } : { first: () => header }),
    context: () => ({ pages: () => [page] }),
    waitForTimeout: async () => {}
  };
  return page;
}

(async () => {
  // 超时报错必须含目标身份 + 最近读取错误原因（不再静默吞错）。
  const page = makeUnreadablePage();
  await assert.rejects(
    () => waitForExpectedDouyinStore(page, { storeId: "29502951", storeName: "DEDAKJ医疗器械旗舰店" }, 300),
    (error) =>
      /目标=DEDAKJ医疗器械旗舰店\(29502951\)/.test(error.message)
      && /最近读取错误=/.test(error.message)
      && /读取抖音/.test(error.message)
  );

  console.log("douyinStoreSwitchDiagnostics.test.js: all assertions passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
