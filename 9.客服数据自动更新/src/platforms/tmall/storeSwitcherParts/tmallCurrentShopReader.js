// 该文件用于解决天猫页面当前店铺名读取和目标店铺等待问题。
const appConfig = require("../../../config/appConfig");

async function readCurrentTmallShopName(page) {
  // 这里优先读取顶部店铺标题，避免把“主店/分店”装饰文案和正文内容混进来。
  const candidates = [
    "span[class*='Frame-module-title']",
    "a[class*='Frame-module-header'] span",
    "a[class*='Frame-module-header']"
  ];

  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }

    const text = (await locator.innerText()).replace(/\s+/g, " ").trim();
    if (text) {
      return text;
    }
  }

  throw new Error("未能读取天猫页面顶部当前店铺名称，请检查页面头部是否发生变化。");
}

async function waitForExpectedShop(page, expectedShopNames, timeoutMs = appConfig.tmall.connectTimeoutMs) {
  // 这里等待页面顶部店铺标题真正切到目标店铺，避免菜单点完后马上继续导致仍然跑错店。
  await page.waitForFunction(
    (shopNames) => {
      const candidates = [
        "span[class*='Frame-module-title']",
        "a[class*='Frame-module-header'] span",
        "a[class*='Frame-module-header']"
      ];

      const currentText = candidates
        .map((selector) => document.querySelector(selector)?.textContent || "")
        .map((text) => text.replace(/\s+/g, " ").trim())
        .find(Boolean);

      const normalizeShopName = (value) =>
        String(value || "")
          .replace(/[:：].*$/, "")
          .replace(/\s+/g, "")
          .replace(/(主店|分店)$/g, "")
          .toLowerCase()
          .trim();

      const normalizedCurrent = normalizeShopName(currentText);
      if (!normalizedCurrent) {
        return false;
      }

      return shopNames.some((shopName) => {
        const normalizedExpected = normalizeShopName(shopName);
        return (
          normalizedExpected &&
          (normalizedCurrent.includes(normalizedExpected) || normalizedExpected.includes(normalizedCurrent))
        );
      });
    },
    expectedShopNames,
    { timeout: timeoutMs }
  );

  return readCurrentTmallShopName(page);
}

module.exports = {
  readCurrentTmallShopName,
  waitForExpectedShop
};
