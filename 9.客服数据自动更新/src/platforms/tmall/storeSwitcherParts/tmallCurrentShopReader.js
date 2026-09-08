// 该文件用于解决天猫页面当前店铺名读取和目标店铺等待问题。
const appConfig = require("../../../config/appConfig");

const TMALL_CURRENT_SHOP_SELECTORS = [
  "span[class*='Frame-module-title']",
  "a[class*='Frame-module-header'] span",
  "a[class*='Frame-module-header']"
];
const TMALL_CURRENT_SHOP_READ_TIMEOUT_MS = 30000;

async function tryReadCurrentTmallShopName(page) {
  // 这里只从既有顶部店铺标题真源读取；页面刚登录完成但头部仍在渲染时返回空串，让上层继续等。
  for (const selector of TMALL_CURRENT_SHOP_SELECTORS) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }

    const text = await locator.innerText().catch(() => "");
    const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
    if (normalizedText) {
      return normalizedText;
    }
  }
  return "";
}

async function readCurrentTmallShopName(page, timeoutMs = TMALL_CURRENT_SHOP_READ_TIMEOUT_MS) {
  // 登录成功页的 title/URL 可能先于 SPA 店铺头部完成渲染；这里等待同一组既有真源，不新增兜底来源。
  const normalizedTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
  const deadline = Date.now() + normalizedTimeoutMs;
  do {
    const currentShopName = await tryReadCurrentTmallShopName(page);
    if (currentShopName) {
      return currentShopName;
    }
    if (Date.now() >= deadline) {
      break;
    }
    const remainingMs = Math.max(1, deadline - Date.now());
    await page.waitForTimeout(Math.min(appConfig.tmall.pageReadyPollIntervalMs || 1000, remainingMs));
  } while (Date.now() <= deadline);

  const pageTitle = await page.title().catch(() => "");
  throw new Error(
    `未能读取天猫页面顶部当前店铺名称，请检查页面头部是否发生变化。当前地址=${page.url()}，标题=${pageTitle || "未读取到"}。`
  );
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
