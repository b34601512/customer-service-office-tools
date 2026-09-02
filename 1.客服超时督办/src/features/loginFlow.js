const readline = require("readline");
const appConfig = require("../config/appConfig");
const { isFullTargetUrl, resolveLoginEntryUrl, writeAppRuntimeConfig } = require("../config/appRuntimeConfig");
const { log } = require("../engine/logger");
const { navigateToTargetPage, navigateToUrl } = require("../engine/browser");
const { assertChatPageReady } = require("./chatPage");
const {
  markLoginStatusValid,
  markLoginStatusInvalid
} = require("./loginStatusStore");

const LOGIN_REQUIRED_PREFIX = "当前登录态已失效";
const LOGIN_CONFIRM_PROMPT = "请在浏览器中完成登录，完成后回到这里按回车继续：";

function isLoginRequiredError(error) {
  // 这里统一判断异常是不是登录态失效，避免上层流程到处手写字符串匹配。
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(LOGIN_REQUIRED_PREFIX);
}

function markCurrentLoginStatusValid(source, detail) {
  // 这里只在工作台页面真实验证通过后写入有效状态，供控制台首页第一步显示绿色。
  markLoginStatusValid(appConfig.loginStatusPath, {
    targetUrl: appConfig.targetUrl,
    source,
    detail
  });
}

function markCurrentLoginStatusInvalid(source, error) {
  // 这里只在明确命中登录失效时写入无效状态，避免其它异常误导用户重新登录。
  markLoginStatusInvalid(appConfig.loginStatusPath, {
    targetUrl: appConfig.targetUrl,
    source,
    detail: error instanceof Error ? error.message : String(error)
  });
}

function waitForEnter(promptText = LOGIN_CONFIRM_PROMPT) {
  // 这里统一等待人工确认，既能兼容终端回车，也能让网页控制台复用同一条提示文案。
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

async function defaultReloadTargetPage(page) {
  // 这里统一按目标页真实可读状态完成刷新，避免登录后靠固定毫秒赌页面何时恢复。
  await navigateToTargetPage(page);
}

async function defaultOpenLoginEntryPage(page) {
  // 这里把失效登录态从有赞 OAuth 错误页带回小蟹账号密码登录入口。
  const loginEntryUrl = resolveLoginEntryUrl(appConfig.targetUrl);
  log("主线:执行", "登录流程", "打开登录入口", `准备访问登录入口：${loginEntryUrl}`);
  await navigateToUrl(page, loginEntryUrl);
}

function persistCurrentTargetUrlIfReady(page) {
  // 这里在人工登录完成后捕获真实聊天页地址，避免主管端还要手工找组织和分组 ID。
  const currentUrl = typeof page.url === "function" ? page.url() : "";
  if (!isFullTargetUrl(currentUrl)) {
    return false;
  }

  if (currentUrl === appConfig.targetUrl) {
    return true;
  }

  const runtimeConfig = writeAppRuntimeConfig(appConfig.appRuntimeConfigPath, {
    targetUrl: currentUrl
  });
  appConfig.targetUrl = runtimeConfig.targetUrl;
  log("主线:完成", "登录流程", "捕获工作台地址", `已写入客服工作台地址：${appConfig.targetUrl}`);
  return true;
}

async function beginInteractiveLogin(page, options = {}) {
  // 这里统一执行人工登录确认链路，让首次登录和后台自恢复共用同一套动作。
  const {
    flowLabel,
    assertPageReady = assertChatPageReady,
    waitForConfirmation = waitForEnter,
    openLoginEntryPage = defaultOpenLoginEntryPage,
    reloadTargetPage = defaultReloadTargetPage
  } = options;

  if (typeof page.bringToFront === "function") {
    await page.bringToFront();
  }

  await openLoginEntryPage(page);
  log("主线:等待", "登录流程", "人工登录", `${flowLabel}检测到未登录，已切换到人工登录，请完成登录后确认继续`);
  await waitForConfirmation(LOGIN_CONFIRM_PROMPT);
  log("主线:执行", "登录流程", "确认当前页", "已收到登录完成确认，先检查当前浏览器是否已经在客服聊天页");

  if (!isFullTargetUrl(appConfig.targetUrl)) {
    await assertPageReady(page);
    if (persistCurrentTargetUrlIfReady(page)) {
      markCurrentLoginStatusValid("interactive_login", `${flowLabel}登录完成，已确认当前登录态可继续使用。`);
      log("主线:完成", "登录流程", "人工登录", `${flowLabel}登录完成，已确认当前登录态可继续使用`);
      return;
    }

    throw new Error(
      `当前配置还只是入口域名，且程序没有自动进入客服聊天工作台。当前配置：${appConfig.targetUrl}，当前页面：${typeof page.url === "function" ? page.url() : "未知"}`
    );
  }

  if (!persistCurrentTargetUrlIfReady(page)) {
    log("主线:执行", "登录流程", "刷新目标页", `当前页不是聊天工作台，重新加载目标页：${appConfig.targetUrl}`);
    await reloadTargetPage(page);
  }

  await assertPageReady(page);
  persistCurrentTargetUrlIfReady(page);
  markCurrentLoginStatusValid("interactive_login", `${flowLabel}登录完成，已确认当前登录态可继续使用。`);
  log("主线:完成", "登录流程", "人工登录", `${flowLabel}登录完成，已确认当前登录态可继续使用`);
}

async function completeLoginMode(page, options = {}) {
  // 这里让显式「首次登录」模式也支持智能跳过，避免用户明明已登录还被要求重复操作。
  const { assertPageReady = assertChatPageReady } = options;

  try {
    await assertPageReady(page);
    persistCurrentTargetUrlIfReady(page);
    markCurrentLoginStatusValid("explicit_login", "当前登录态仍有效，无需重复执行首次登录。");
    log("主线:完成", "登录流程", "登录态复用", "当前登录态仍有效，无需重复执行首次登录");
    return "already_logged_in";
  } catch (error) {
    if (!isLoginRequiredError(error)) {
      throw error;
    }
    markCurrentLoginStatusInvalid("explicit_login", error);
  }

  await beginInteractiveLogin(page, {
    ...options,
    assertPageReady,
    flowLabel: "首次登录流程"
  });
  return "login_completed";
}

async function ensureLoginReadyForRun(page, options = {}) {
  // 这里在后台启动前先自检登录态，未登录就自动转入人工登录，成功后再继续日常督办。
  const { assertPageReady = assertChatPageReady } = options;
  log("主线:执行", "登录流程", "登录态自检", "后台启动前开始检查当前登录态");

  try {
    await assertPageReady(page);
    persistCurrentTargetUrlIfReady(page);
    markCurrentLoginStatusValid("run_precheck", "后台启动前已确认登录态有效。");
    log("主线:完成", "登录流程", "登录态自检", "已确认登录态有效，继续进入后台督办");
    return "ready";
  } catch (error) {
    if (!isLoginRequiredError(error)) {
      throw error;
    }
    markCurrentLoginStatusInvalid("run_precheck", error);
  }

  await beginInteractiveLogin(page, {
    ...options,
    assertPageReady,
    flowLabel: "后台督办"
  });
  return "login_completed";
}

module.exports = {
  ensureLoginReadyForRun,
  completeLoginMode,
  isLoginRequiredError,
  persistCurrentTargetUrlIfReady,
  waitForEnter,
  LOGIN_CONFIRM_PROMPT
};
