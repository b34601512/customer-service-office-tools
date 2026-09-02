// 该文件用于解决京东登录辅助主流程调度的问题。
const { connectToChrome, disconnectFromChrome } = require("../../../engine/chromeSession");
const { log } = require("../../../engine/logger");
const { hasJdSessionExpiredText, isJdPassportLoginUrl } = require("../jdLoginPageClassifier");
const { findReadyJdPage } = require("../loginReadyParts/jdReadyPageSearch");
const { waitForDynamicLoginSurface, waitForLoginTransition } = require("../loginSurfaceParts/jdLoginSurfaceState");
const { tryClickLoginEntry, tryClickExpiredSessionDialog } = require("../loginSurfaceParts/jdLoginEntryActions");
const { collectAssistPages } = require("../jdLoginAssistPages");
const { stabilizeJdBrowser } = require("../jdPageGuards");
const { waitForJdDebugBrowserReady } = require("./jdDebugBrowserReady");
const { shouldStopJdLoginAssist } = require("./jdAssistTaskState");
const { tryAutofillJdSurfaceOnce } = require("./jdAutofillMarks");
const { redirectJdNoAccessToLogin } = require("../jdNoAccessLoginRedirect");
const { readJdPageBodyText } = require("../jdPageText");

function buildJdLoginAssistRunnerOptions(options = {}) {
  // 这里保留调用方传入的登录成功回调，避免自动检测成功后控制台仍停在未登录。
  return {
    ...options,
    forceRestart: Boolean(options.forceRestart)
  };
}

async function notifyJdLoginReady(page, resolvedConfig, options = {}) {
  // 这里把京东登录成功事件写成统一回调参数，供当前汇总任务更新进度。
  if (typeof options.onLoginReady !== "function") {
    return;
  }

  const bodyText = await readJdPageBodyText(page);
  await options.onLoginReady({
    storeKey: resolvedConfig.activeStore.key,
    displayName: resolvedConfig.activeStore.displayName,
    currentUrl: page.url(),
    currentTitle: await page.title(),
    currentPageText: String(bodyText || "").replace(/\s+/g, " ").trim().slice(0, 120)
  });
}

async function tryClickJdExpiredSessionDialogOnPage(page) {
  // 这里只负责遍历页面和 iframe 查找过期弹窗登录按钮。
  const expiredSurfaces = [page, ...(typeof page.frames === "function" ? page.frames() : [])];
  for (const surface of expiredSurfaces) {
    const clickResult = await tryClickExpiredSessionDialog(surface);
    if (clickResult?.clicked) {
      return clickResult;
    }
  }

  return {
    clicked: false,
    method: ""
  };
}

async function handleJdExpiredSession(page, pageBodyText, resolvedConfig) {
  // 这里只处理过期弹窗，恢复到登录链路后交回主循环。
  const expiredTextDetected = hasJdSessionExpiredText(pageBodyText);
  const displayName = resolvedConfig.activeStore.displayName;
  const clickResult = await tryClickJdExpiredSessionDialogOnPage(page);
  if (!expiredTextDetected && !clickResult?.clicked) {
    return false;
  }

  log(
    "主线:执行",
    "京东登录",
    "过期弹窗",
    expiredTextDetected
      ? `店铺「${displayName}」检测到登录已过期弹窗，当前地址=${page.url()}`
      : `店铺「${displayName}」检测到可点击的登录弹窗按钮，当前地址=${page.url()}`
  );

  if (clickResult?.clicked) {
    log(
      "主线:完成",
      "京东登录",
      "过期弹窗",
      `店铺「${displayName}」已点击过期弹窗登录按钮，方式=${clickResult.method}${clickResult.label ? `，文案=${clickResult.label}` : ""}`
    );
  }

  log("主线:完成", "京东登录", "过期弹窗", `店铺「${displayName}」已处理过期状态，继续等待京东系统登录页`);
  return true;
}

async function clickJdLoginEntryIfNeeded(page, url, displayName) {
  // 这里只负责从业务页点击到登录页，登录表单识别交给后续步骤。
  if (isJdPassportLoginUrl(url)) {
    return;
  }

  const loginSurfaces = [page, ...page.frames()];
  for (const surface of loginSurfaces) {
    const clicked = await tryClickLoginEntry(surface);
    if (clicked) {
      log("主线:完成", "京东登录", "自动点击", `店铺「${displayName}」已点击登录入口，准备进入登录页`);
      await waitForLoginTransition(page, 2000);
      return;
    }
  }
}

async function tryAutofillJdLoginPage(page, credentials, autofilledSurfaceMarks, displayName) {
  // 这里只负责在已识别的登录面写入账号密码。
  const loginSurfaceReady = await waitForDynamicLoginSurface(page, 200);
  if (!loginSurfaceReady) {
    return false;
  }

  const surfaces = [page, ...page.frames()];
  for (const surface of surfaces) {
    const autofillResult = await tryAutofillJdSurfaceOnce(surface, credentials, autofilledSurfaceMarks);
    if (autofillResult.filled) {
      log("主线:完成", "京东登录", "自动填充", `店铺「${displayName}」账号密码已写入，并已尝试点击登录按钮；如出现验证码或滑块请人工完成`);
      return true;
    }
  }

  return false;
}

function resolveJdLoginAssistConfig(options = {}) {
  // 这里只接收当前汇总任务已经锁定的店铺，禁止辅助线程另读一套焦点。
  if (options.resolvedConfig?.activeStore?.key) {
    return options.resolvedConfig;
  }
  throw new Error("启动京东登录辅助失败：缺少当前汇总任务的店铺配置。");
}

async function finishJdAssistIfAlreadyReady(browser, resolvedConfig, displayName, options = {}) {
  // 这里仅确认京东系统登录态可用。
  const readyPage = await findReadyJdPage(browser, resolvedConfig.activeStore);
  if (readyPage) {
    log("主线:完成", "京东登录", "自动检测", `店铺「${displayName}」已登录成功，当前页=${readyPage.url()}`);
    await notifyJdLoginReady(readyPage, resolvedConfig, options);
    return true;
  }

  return false;
}

async function processJdAssistPage(page, resolvedConfig, credentials, autofilledSurfaceMarks) {
  // 这里处理单个京东辅助页，把主循环从页面内细节中解放出来。
  const displayName = resolvedConfig.activeStore.displayName;
  const url = page.url();
  if (!/passport\.jd\.com|passport\.shop\.jd\.com|xi\.jd\.com|kf\.jd\.com/i.test(url)) {
    return;
  }

  if (await redirectJdNoAccessToLogin(page, resolvedConfig.activeStore)) {
    return;
  }

  const pageBodyText = await readJdPageBodyText(page);
  const expiredHandled = await handleJdExpiredSession(page, pageBodyText, resolvedConfig);
  if (expiredHandled) {
    return;
  }

  await clickJdLoginEntryIfNeeded(page, url, displayName);
  await tryAutofillJdLoginPage(page, credentials, autofilledSurfaceMarks, displayName);
}

async function runJdLoginAssist(assistTask, options = {}) {
  // 这里持续观察京东登录页并自动处理登录入口，直到当前店铺登录态可用。
  const resolvedConfig = resolveJdLoginAssistConfig(options);
  const { username, password, displayName } = resolvedConfig.activeStore;
  const hasCredentials = Boolean(username && password);
  const autofilledSurfaceMarks = new WeakSet();

  if (!hasCredentials) {
    log("主线:跳过", "京东登录", "自动填充", `店铺「${displayName}」未配置账号或密码，仍会等待登录页出现`);
  }

  log("主线:等待", "京东登录", "浏览器就绪", `店铺「${displayName}」正在等待调试浏览器端口就绪`);
  const debugBrowserReady = await waitForJdDebugBrowserReady();
  if (!debugBrowserReady) {
    throw new Error("京东登录辅助启动失败：打开窗口后 15 秒内仍未检测到调试浏览器。");
  }
  if (shouldStopJdLoginAssist(assistTask, displayName)) {
    return;
  }

  const browser = await connectToChrome();
  try {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() <= deadline) {
      if (shouldStopJdLoginAssist(assistTask, displayName)) {
        return;
      }

      if (await finishJdAssistIfAlreadyReady(browser, resolvedConfig, displayName, options)) {
        return;
      }

      for (const page of collectAssistPages(browser, resolvedConfig.activeStore)) {
        if (shouldStopJdLoginAssist(assistTask, displayName)) {
          return;
        }
        await processJdAssistPage(page, resolvedConfig, { username, password }, autofilledSurfaceMarks);
      }

      await stabilizeJdBrowser(browser);
      await new Promise((resolve) => setImmediate(resolve));
    }

    throw new Error("京东登录辅助超时，5 分钟内未检测到可填充的登录页或登录成功状态。");
  } finally {
    await disconnectFromChrome(browser, "京东登录辅助已完成，主动断开调试连接");
  }
}

module.exports = {
  buildJdLoginAssistRunnerOptions,
  handleJdExpiredSession,
  tryClickJdExpiredSessionDialogOnPage,
  tryAutofillJdLoginPage,
  resolveJdLoginAssistConfig,
  finishJdAssistIfAlreadyReady,
  runJdLoginAssist
};
