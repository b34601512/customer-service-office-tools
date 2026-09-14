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

function isLoginSurfaceRaceError(error) {
  // 这个函数只识别“填表过程中页面已经跳走”的竞态错误。
  // 京东登录成功的瞬间会从登录页跳到业务页，此时 fill 会报超时或元素脱离；
  // 这属于竞态收敛而不是真失败，绝不能因此让整店失败。
  const message = String(error?.message || "");
  return /Timeout \d+ms exceeded|not attached|detached|Execution context was destroyed|Target closed|Target page, context or browser has been closed/i.test(message);
}

async function fillJdLoginCredentials(usernameLocator, passwordLocator, credentials) {
  // 这个函数只把非空京东账号密码写入已定位输入框；填入失败（页面跳转）时返回 false 交回上层重新判断。
  const fillOnce = async (locator, value) => {
    if (!value) {
      return true;
    }
    try {
      await locator.fill(value, { timeout: 5000 });
      return true;
    } catch (error) {
      if (isLoginSurfaceRaceError(error)) {
        return false;
      }
      throw error;
    }
  };
  const usernameFilled = await fillOnce(usernameLocator, credentials.username);
  const passwordFilled = await fillOnce(passwordLocator, credentials.password);
  return usernameFilled && passwordFilled;
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
  const filled = await fillJdLoginCredentials(usernameLocator, passwordLocator, credentials);
  if (!filled) {
    // 登录页在填表过程中已跳走（登录成功或人工完成验证），交回上层继续轮询登录状态。
    return false;
  }
  const submitLocator = await findJdPasswordLoginSubmitButton(surface);
  if (!submitLocator) {
    throw new Error("京东登录按钮定位失败：账号密码已填写，但未找到唯一密码提交按钮 #loginsubmit。");
  }
  await clickLocatorWhenReady(submitLocator, "京东登录按钮", { timeoutMs: 5000 });
  return true;
}

module.exports = {
  tryAutofillLoginFrame,
  fillJdLoginCredentials,
  isLoginSurfaceRaceError
};
