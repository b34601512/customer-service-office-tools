// 拼多多登录页只由脚本填充账号密码；验证码、滑块和扫码始终留给用户。
const { clickLocatorWhenReady } = require("../../shared/browserActionEngine");

async function isLocatorVisible(locator) {
  return Boolean(locator && (await locator.count()) > 0 && (await locator.isVisible().catch(() => false)));
}

async function findFirstVisibleLocator(frame, selectors) {
  for (const selector of selectors) {
    const group = frame.locator(selector);
    const count = await group.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const locator = typeof group.nth === "function" ? group.nth(index) : group.first();
      if (await isLocatorVisible(locator)) return locator;
    }
  }
  return null;
}

async function clickFirstVisibleTextCandidate(frame, text) {
  const candidates = [];
  if (typeof frame.getByRole === "function") {
    candidates.push(frame.getByRole("tab", { name: text, exact: true }));
    candidates.push(frame.getByRole("button", { name: text, exact: true }));
  }
  if (typeof frame.getByText === "function") candidates.push(frame.getByText(text, { exact: true }));
  candidates.push(frame.locator(`button:has-text("${text}")`));
  candidates.push(frame.locator(`a:has-text("${text}")`));
  candidates.push(frame.locator(`span:has-text("${text}")`));
  for (const group of candidates) {
    const count = await group.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const locator = typeof group.nth === "function" ? group.nth(index) : group.first();
      if (!(await isLocatorVisible(locator))) continue;
      await clickLocatorWhenReady(locator, `拼多多登录方式切换${text}`, { timeoutMs: 3000 });
      return true;
    }
  }
  return false;
}

async function trySwitchToAccountLogin(frame) {
  const passwordInput = await findFirstVisibleLocator(frame, [
    "input[type='password']", "input[placeholder*='密码']", "input[name*='password']"
  ]);
  if (passwordInput) return false;
  for (const text of ["账号登录", "账户登录", "密码登录"]) {
    if (await clickFirstVisibleTextCandidate(frame, text)) return true;
  }
  return false;
}

async function tryAutofillPddLoginFrame(frame, credentials = {}) {
  const switched = await trySwitchToAccountLogin(frame).catch(() => false);
  const usernameLocator = await findFirstVisibleLocator(frame, [
    "input[placeholder*='账号名']", "input[placeholder*='手机号']", "input[placeholder*='账号']",
    "input[type='tel']", "input[type='text']", "input[name*='user']", "input[name*='phone']"
  ]).catch(() => null);
  const passwordLocator = await findFirstVisibleLocator(frame, [
    "input[type='password']", "input[placeholder*='密码']", "input[name*='password']"
  ]).catch(() => null);
  if (!usernameLocator || !passwordLocator) return { switched, filled: false };
  if (credentials.username) await usernameLocator.fill(credentials.username);
  if (credentials.password) await passwordLocator.fill(credentials.password);
  const submitLocator = await findFirstVisibleLocator(frame, [
    "button[type='submit']", "button:has-text('登录')", "button:has-text('立即登录')",
    "[role='button']:has-text('登录')"
  ]).catch(() => null);
  if (submitLocator) await clickLocatorWhenReady(submitLocator, "拼多多登录按钮", { timeoutMs: 5000 }).catch(() => {});
  return { switched, filled: Boolean(credentials.username || credentials.password) };
}

module.exports = {
  isLocatorVisible,
  findFirstVisibleLocator,
  clickFirstVisibleTextCandidate,
  trySwitchToAccountLogin,
  tryAutofillPddLoginFrame
};
