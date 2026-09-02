const { findFirstVisibleLocator } = require("./tmallLoginSurface");

async function hasVisiblePasswordInput(frame) {
  return frame.locator("input[type='password'], input[name*='password'], input[placeholder*='密码']")
    .evaluateAll((nodes) => nodes.some((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    }));
}

async function switchToPasswordLogin(frame) {
  if (await hasVisiblePasswordInput(frame)) return false;
  for (const switchText of ["密码登录", "账号登录", "账户登录"]) {
    const switchLocator = frame.getByText(switchText, { exact: false }).first();
    if ((await switchLocator.count()) > 0 && (await switchLocator.isVisible().catch(() => false))) {
      await switchLocator.click({ timeout: 5000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function fillTmallLoginFrame(frame, credentials) {
  if (await switchToPasswordLogin(frame)) return "switched";
  const usernameLocator = await findFirstVisibleLocator(frame, [
    "input#fm-login-id",
    "input[name='fm-login-id']",
    "input[placeholder*='会员名']",
    "input[placeholder*='账号']",
    "input[type='text']",
    "input[type='tel']"
  ]);
  const passwordLocator = await findFirstVisibleLocator(frame, [
    "input#fm-login-password",
    "input[name='fm-login-password']",
    "input[type='password']",
    "input[placeholder*='密码']"
  ]);
  if (!usernameLocator || !passwordLocator) return "missing";
  await usernameLocator.fill(credentials.username);
  await passwordLocator.fill(credentials.password);
  const submitLocator = await findFirstVisibleLocator(frame, [
    "button[type='submit']",
    "button.fm-submit",
    ".fm-submit",
    "button:has-text('登录')"
  ]);
  if (submitLocator) await submitLocator.click({ timeout: 5000 }).catch(() => {});
  return "submitted";
}

async function tryAutofillTmallLoginPage(page, storeConfig, submittedFrames) {
  const username = String(storeConfig?.username || "").trim();
  const password = String(storeConfig?.password || "").trim();
  if (!username || !password) return false;
  for (const frame of page.frames()) {
    if (submittedFrames.has(frame)) continue;
    const fillResult = await fillTmallLoginFrame(frame, { username, password }).catch(() => "missing");
    if (fillResult === "submitted") {
      submittedFrames.add(frame);
      return true;
    }
  }
  return false;
}

module.exports = {
  hasVisiblePasswordInput,
  switchToPasswordLogin,
  fillTmallLoginFrame,
  tryAutofillTmallLoginPage
};
