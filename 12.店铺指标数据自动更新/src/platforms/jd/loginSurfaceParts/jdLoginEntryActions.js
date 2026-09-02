const { clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const {
  resolveJdLoginSurfacePage,
  findFirstVisibleJdLoginLocator,
  findJdExpiredSessionLoginButton
} = require("./jdLoginSurfaceLocator");

function buildLoginEntryClickOptions(options = {}) {
  // 这个函数只组装登录入口点击引擎需要的参数。
  const clickOptions = { timeoutMs: Math.max(1, Number(options.timeoutMs) || 3000) };
  ["pollIntervalMs", "minimumClickIntervalMs", "requireTrialClick"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      clickOptions[key] = options[key];
    }
  });
  return clickOptions;
}

async function tryClickLoginEntry(surface, options = {}) {
  // 这个函数只点击既有地址或文案明确等于登录的入口。
  const loginLocator = await findFirstVisibleJdLoginLocator(surface, [
    "a.hd-login",
    "a[href*='sers.action']",
    "a[href*='login']",
    "button:text-is('立即登录')",
    "a:text-is('立即登录')",
    "[role='button']:text-is('立即登录')",
    "button:text-is('登录')",
    "a:text-is('登录')",
    "[role='button']:text-is('登录')"
  ]);
  if (!loginLocator) {
    return false;
  }
  await clickLocatorWhenReady(loginLocator, "京东登录入口", buildLoginEntryClickOptions(options));
  return true;
}

async function tryClickExpiredSessionDialog(surface) {
  // 这个函数只点击登录过期弹窗中已定位的主按钮。
  const dialogLocator = await findJdExpiredSessionLoginButton(surface);
  if (!dialogLocator) {
    return { clicked: false, method: "" };
  }
  await clickLocatorWhenReady(dialogLocator, "京东登录过期弹窗主按钮", { timeoutMs: 3000 });
  return { clicked: true, method: "locator" };
}

async function trySwitchToPasswordLogin(surface) {
  // 这个函数只尝试切换到既有密码登录入口并等待页面加载。
  const candidateTexts = ["密码登录", "账号登录", "账户登录"];
  for (const text of candidateTexts) {
    const locator = surface.getByText(text, { exact: false }).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      await clickLocatorWhenReady(locator, `京东登录方式切换${text}`, { timeoutMs: 3000 });
      const page = resolveJdLoginSurfacePage(surface);
      if (page && typeof page.waitForLoadState === "function") {
        await page.waitForLoadState("domcontentloaded", { timeout: 3000 });
      }
      return true;
    }
  }
  return false;
}

module.exports = {
  tryClickLoginEntry,
  tryClickExpiredSessionDialog,
  trySwitchToPasswordLogin
};
