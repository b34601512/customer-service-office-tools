const readline = require("readline");
const appConfig = require("../config/appConfig");
const { isFullTargetUrl, writeAppRuntimeConfig } = require("../config/appRuntimeConfig");
const { log } = require("../engine/logger");
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

function createLoginRequiredError(source, detail) {
  const error = new Error(`${LOGIN_REQUIRED_PREFIX}，后台监控已停止。请在控制台选择「首次登录」，完成后再「后台启动」。${detail || ""}`);
  markCurrentLoginStatusInvalid(source, error);
  return error;
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

function waitForEnter(promptText = LOGIN_CONFIRM_PROMPT, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("登录窗口已关闭，首次登录已取消。"));
    // Windows 的管道即使 readline.close() 后仍引用事件循环；只在等待输入时持有它。
    process.stdin.ref?.();
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      rl.close();
      process.stdin.unref?.();
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error("登录窗口已关闭，首次登录已取消。"));
    signal?.addEventListener("abort", abort, { once: true });
    rl.on("close", () => finish(new Error("登录确认输入已关闭，首次登录已取消。")));
    rl.question(`${promptText}\n`, () => finish());
  });
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
  const {
    flowLabel,
    assertPageReady = assertChatPageReady,
    waitForConfirmation = waitForEnter,
    signal
  } = options;

  if (typeof page.bringToFront === "function") {
    await page.bringToFront();
  }

  log("主线:等待", "登录流程", "人工登录", "请在浏览器登录，并进入需要监控的聊天工作台后确认。支持新标签页，不会跳回旧地址。");
  while (true) {
    await waitForConfirmation(LOGIN_CONFIRM_PROMPT, { signal });
    const pages = page.context().pages().filter((candidate) => !candidate.isClosed());
    const candidates = pages.filter((candidate) => isFullTargetUrl(candidate.url()));
    const urls = new Set(candidates.map((candidate) => candidate.url()));
    if (urls.size !== 1) {
      log("主线:等待", "登录流程", "人工登录", urls.size > 1
        ? "检测到多个不同聊天工作台，请关闭不需要监控的工作台标签页，再确认。"
        : "尚未发现聊天工作台。请在浏览器进入聊天工作台，再点击完成登录；无需重新打开登录入口。");
      continue;
    }
    const targetPage = candidates[candidates.length - 1];
    try {
      await assertPageReady(targetPage);
    } catch (error) {
      if (!isLoginRequiredError(error)) throw error;
      markCurrentLoginStatusInvalid("interactive_login", error);
      log("主线:等待", "登录流程", "人工登录", "工作台仍未通过登录校验，请完成登录后再次确认。");
      continue;
    }
    if (!persistCurrentTargetUrlIfReady(targetPage)) {
      log("主线:等待", "登录流程", "人工登录", "工作台地址已发生跳转，请进入聊天工作台后再次确认。");
      continue;
    }
    markCurrentLoginStatusValid("interactive_login", `${flowLabel}登录完成，已确认当前登录态可继续使用。`);
    log("主线:完成", "登录流程", "人工登录", `${flowLabel}登录完成，已确认当前登录态可继续使用`);
    return;
  }
}

async function completeLoginMode(page, options = {}) {
  // 这里让显式「首次登录」模式也支持智能跳过，避免用户明明已登录还被要求重复操作。
  const { assertPageReady = assertChatPageReady } = options;

  try {
    if (!isFullTargetUrl(page.url())) {
      throw new Error(`${LOGIN_REQUIRED_PREFIX}，请先进入聊天工作台。`);
    }
    await assertPageReady(page);
    if (!persistCurrentTargetUrlIfReady(page)) throw new Error(`${LOGIN_REQUIRED_PREFIX}，工作台已跳转。`);
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
  // 无头页面只校验登录，不等待不可见的人工操作；人工登录统一由 login 入口负责。
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
    throw createLoginRequiredError("run_precheck", error.message);
  }
}

module.exports = {
  ensureLoginReadyForRun,
  createLoginRequiredError,
  completeLoginMode,
  isLoginRequiredError,
  persistCurrentTargetUrlIfReady,
  waitForEnter,
  LOGIN_CONFIRM_PROMPT
};
