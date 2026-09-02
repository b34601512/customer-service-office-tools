const appConfig = require("../../config/appConfig");
const { log } = require("../../engine/logger");
const { clickLocatorWhenReady } = require("../../shared/browserActionEngine");
const { findFirstVisibleLocator } = require("./tmallLoginSurface");

function buildTmallLoginClickOptions(timeoutMs) {
  // 这个函数只定义登录页按钮的点击节奏。
  return {
    timeoutMs,
    pollIntervalMs: appConfig.tmall.loginActionPollIntervalMs,
    minimumClickIntervalMs: appConfig.tmall.loginClickIntervalMs,
    requireTrialClick: false
  };
}

async function hasVisiblePasswordInput(frame) {
  // 这个函数只判断当前登录面是否已经切到密码登录。
  return frame
    .locator("input[type='password'], input[name*='password'], input[placeholder*='密码']")
    .evaluateAll((nodes) =>
      nodes.some((element) => {
        const style = window.getComputedStyle(element);
        return (
          style &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      })
    );
}

async function switchToPasswordLogin(frame) {
  // 这个函数只在没有密码框时切换一次登录方式。
  for (const text of ["密码登录", "账号登录", "账户登录", "短信登录"]) {
    if (await hasVisiblePasswordInput(frame)) {
      return false;
    }
    const locator = frame.getByText(text, { exact: false }).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      await clickLocatorWhenReady(
        locator,
        `天猫登录方式切换${text}`,
        buildTmallLoginClickOptions(3000)
      );
      return true;
    }
  }
  return false;
}

async function fillTmallLoginFrame(frame, credentials, autofilledFrames) {
  // 这个函数只填写一个尚未处理的登录面并点击登录。
  if (autofilledFrames.has(frame)) {
    return false;
  }
  if (await switchToPasswordLogin(frame)) {
    return false;
  }
  const usernameLocator = await findFirstVisibleLocator(frame, [
    "input[type='text']",
    "input[type='tel']",
    "input[id*='fm-login-id']",
    "input[name*='user']",
    "input[placeholder*='会员名']",
    "input[placeholder*='账号']",
    "input[placeholder*='手机号']"
  ]);
  const passwordLocator = await findFirstVisibleLocator(frame, [
    "input[type='password']",
    "input[name*='password']",
    "input[placeholder*='密码']"
  ]);
  if (!usernameLocator || !passwordLocator) {
    return false;
  }
  await usernameLocator.fill(credentials.username);
  await passwordLocator.fill(credentials.password);
  const submitLocator = await findFirstVisibleLocator(frame, [
    "button[type='submit']",
    "button.fm-submit",
    ".fm-submit",
    "button:has-text('登录')"
  ]);
  if (submitLocator) {
    await clickLocatorWhenReady(
      submitLocator,
      "天猫登录按钮",
      buildTmallLoginClickOptions(5000)
    );
  }
  autofilledFrames.add(frame);
  return true;
}

async function tryAutofillTmallLoginPage(page, storeConfig, autofilledFrames) {
  // 这个函数只让当前主流程在当前页面尝试一次自动登录。
  const username = String(storeConfig?.username || "").trim();
  const password = String(storeConfig?.password || "").trim();
  if (!username || !password) {
    return false;
  }
  for (const frame of page.frames()) {
    if (await fillTmallLoginFrame(frame, { username, password }, autofilledFrames)) {
      log(
        "主线:完成",
        "天猫登录",
        "自动填充",
        `店铺「${storeConfig.displayName || storeConfig.key}」账号密码已填写；如出现验证码或滑块请人工完成`
      );
      return true;
    }
  }
  return false;
}

module.exports = {
  tryAutofillTmallLoginPage
};
