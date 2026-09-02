const { clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const {
  resolveJdLoginSurfacePage,
  findFirstVisibleJdLoginLocator,
  findJdPasswordLoginSubmitButton
} = require("./jdLoginSurfaceLocator");
const { trySwitchToPasswordLogin } = require("./jdLoginEntryActions");

async function waitForJdLoginInputsAfterSwitch(page) {
  // 这个函数只等待切换密码登录后可见账号或密码输入框出现。
  await page.waitForFunction(
    () => {
      const candidates = Array.from(document.querySelectorAll("input"));
      return candidates.some((element) => {
        const style = window.getComputedStyle(element);
        const visible = style && style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
        if (!visible) {
          return false;
        }
        const text = [
          element.getAttribute("placeholder"),
          element.getAttribute("aria-label"),
          element.getAttribute("name")
        ].filter(Boolean).join(" ");
        return /账号|邮箱|密码|登录|手机号|user|login/i.test(text);
      });
    },
    { timeout: 3000, polling: "mutation" }
  );
}

async function fillJdLoginCredentials(usernameLocator, passwordLocator, credentials) {
  // 这个函数只把非空京东账号密码写入已定位输入框。
  if (credentials.username) {
    await usernameLocator.fill(credentials.username);
  }
  if (credentials.password) {
    await passwordLocator.fill(credentials.password);
  }
}

async function tryAutofillLoginFrame(surface, credentials) {
  // 这个函数只填入账号密码并点击唯一京东密码提交按钮。
  const switched = await trySwitchToPasswordLogin(surface);
  const page = resolveJdLoginSurfacePage(surface);
  if (switched && page) {
    await waitForJdLoginInputsAfterSwitch(page);
  }
  const usernameLocator = await findFirstVisibleJdLoginLocator(surface, [
    "input[type='text']",
    "input[type='tel']",
    "input[name*='user']",
    "input[name*='login']",
    "input[placeholder*='账号名/邮箱']",
    "input[placeholder*='账号名']",
    "input[placeholder*='邮箱']",
    "input[placeholder*='账号']",
    "input[placeholder*='手机号']",
    "input[placeholder*='用户名']"
  ]);
  const passwordLocator = await findFirstVisibleJdLoginLocator(surface, [
    "input[type='password']",
    "input[name*='password']",
    "input[placeholder*='密码']",
    "input[placeholder*='登录密码']"
  ]);
  if (!usernameLocator || !passwordLocator) {
    return false;
  }
  await fillJdLoginCredentials(usernameLocator, passwordLocator, credentials);
  const submitLocator = await findJdPasswordLoginSubmitButton(surface);
  if (!submitLocator) {
    throw new Error("京东登录按钮定位失败：账号密码已填写，但未找到唯一密码提交按钮 #loginsubmit。");
  }
  await clickLocatorWhenReady(submitLocator, "京东登录按钮", { timeoutMs: 5000 });
  return true;
}

module.exports = {
  tryAutofillLoginFrame
};
