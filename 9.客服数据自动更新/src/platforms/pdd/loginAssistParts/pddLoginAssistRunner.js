// 该文件用于解决拼多多登录辅助主循环、浏览器接管和登录成功检测问题。
const { connectToChrome, disconnectFromChrome } = require("../../../engine/chromeSession");
const { log } = require("../../../engine/logger");
const { isPddBusinessUrl, findPddLoginReadyPage } = require("../pddLoginState");
const { buildPddStoreIdentityStatus } = require("../pddStoreIdentity");
const { readPddPageBodyText } = require("../pddPageText");
const {
  waitForPddDebugBrowserReady,
  collectBrowserPageUrls,
  buildBrowserPageScanLog,
  normalizeLogPreview,
  wait,
  collectPddLoginSurfaces,
  describePddLoginSurfaceState
} = require("./pddLoginSurfaceState");
const { tryAutofillPddSurfaceOnce } = require("./pddLoginAutofillMarks");

const PDD_LOGIN_ASSIST_POLL_INTERVAL_MS = 1000;

function getPddLoginAssistPollIntervalMs() {
  // 这里暴露登录辅助轮询间隔给测试，避免以后误退回 3 秒低频扫描。
  return PDD_LOGIN_ASSIST_POLL_INTERVAL_MS;
}

function buildPddLoginAssistRunnerOptions(options = {}) {
  // 这里保留调用方传入的登录成功回调，避免拼多多自动检测成功后控制台仍停在未登录。
  return {
    ...options,
    forceRestart: Boolean(options.forceRestart)
  };
}

function shouldStopPddLoginAssist(assistTask, displayName) {
  // 这里在每轮处理前确认自己还是最新任务，过期任务会立刻退出，避免二次打开窗口时互相抢。
  if (assistTask?.isCurrent()) {
    return false;
  }

  log("主线:中断", "拼多多登录", "自动填充", `店铺「${displayName}」检测到新的打开窗口请求，上一轮登录辅助流程已停止`);
  return true;
}

async function notifyPddLoginReady(page, resolvedConfig, options = {}) {
  // 这里把拼多多登录成功事件写成统一回调参数，供当前汇总任务更新进度。
  if (typeof options.onLoginReady !== "function") {
    return;
  }

  const bodyText = await readPddPageBodyText(page);
  const identityStatus = buildPddStoreIdentityStatus(bodyText, resolvedConfig.activeStore);
  await options.onLoginReady({
    storeKey: resolvedConfig.activeStore.key,
    displayName: resolvedConfig.activeStore.displayName,
    currentUrl: page.url(),
    currentTitle: await page.title(),
    currentPageText: String(bodyText || "").replace(/\s+/g, " ").trim().slice(0, 120),
    expectedIdentityText: identityStatus.expectedIdentityText,
    storeIdentityText: identityStatus.storeIdentityText,
    identityMatched: identityStatus.identityMatched
  });
}

async function finishPddAssistIfAlreadyReady(browser, resolvedConfig, displayName, options = {}) {
  // 这里复用手动刷新同款登录判断，并短等页面文本稳定，避免登录后刚跳转时读早了。
  const readyPage = await findPddLoginReadyPage(browser, {
    storeConfig: resolvedConfig.activeStore,
    timeoutMs: options.loginReadyTimeoutMs || 1200,
    pollIntervalMs: options.loginReadyPollIntervalMs || 200
  });

  if (readyPage) {
    log("主线:完成", "拼多多登录", "自动检测", `店铺「${displayName}」已登录成功，当前页=${readyPage.url()}`);
    await notifyPddLoginReady(readyPage, resolvedConfig, options);
    return true;
  }

  return false;
}

async function runPddLoginAssist(assistTask, options = {}) {
  // 这里持续观察拼多多登录页，自动切账号登录并填账号密码，最终登录动作交给用户手工完成。
  const resolvedConfig = options.resolvedConfig;
  if (!resolvedConfig?.activeStore) {
    throw new Error("启动拼多多登录辅助失败：缺少当前汇总任务的店铺配置。");
  }
  const { username, password, displayName } = resolvedConfig.activeStore;
  const hasCredentials = Boolean(username && password);
  const autofilledSurfaceMarks = new WeakSet();

  if (!hasCredentials) {
    log("主线:跳过", "拼多多登录", "自动填充", `店铺「${displayName}」未配置账号或密码，只会尝试切换到账号登录`);
  }

  log("主线:等待", "拼多多登录", "浏览器就绪", `店铺「${displayName}」正在等待调试浏览器端口就绪`);
  const debugBrowserReady = await waitForPddDebugBrowserReady();
  if (!debugBrowserReady) {
    throw new Error("拼多多登录辅助启动失败：打开窗口后 15 秒内仍未检测到调试浏览器。");
  }
  log("主线:完成", "拼多多登录", "浏览器就绪", `店铺「${displayName}」已检测到调试端口，准备接管 Chrome 会话`);
  if (shouldStopPddLoginAssist(assistTask, displayName)) {
    return;
  }

  const browser = await connectToChrome({
    timeoutMs: 15000,
    portReadyTimeoutMs: 15000
  });

  try {
    const deadline = Date.now() + 5 * 60 * 1000;
    let lastPageScanLogKey = "";
    let lastLoginSurfaceLogKey = "";

    const initialPageUrls = collectBrowserPageUrls(browser);
    log("主线:完成", "拼多多登录", "接管会话", buildBrowserPageScanLog(initialPageUrls));

    while (Date.now() <= deadline) {
      if (shouldStopPddLoginAssist(assistTask, displayName)) {
        return;
      }

      const pageUrls = collectBrowserPageUrls(browser);
      const pageScanLogKey = pageUrls.join("|");
      if (pageScanLogKey !== lastPageScanLogKey) {
        lastPageScanLogKey = pageScanLogKey;
        log("主线:记录", "拼多多登录", "页面扫描", buildBrowserPageScanLog(pageUrls));
      }

      if (await finishPddAssistIfAlreadyReady(browser, resolvedConfig, displayName, options)) {
        return;
      }

      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          if (shouldStopPddLoginAssist(assistTask, displayName)) {
            return;
          }
          if (!isPddBusinessUrl(page.url())) {
            continue;
          }

          const loginSurfaces = await collectPddLoginSurfaces(page);
          if (!loginSurfaces.length) {
            continue;
          }

          const loginSurfaceLogKey = `${page.url()}|${loginSurfaces
            .map(({ state }) => `${state.surfaceUrl}:${state.hasLoginFormText}:${state.hasAccountSwitchText}:${state.hasAccountInput}:${state.hasPasswordInput}`)
            .join(";")}`;
          if (loginSurfaceLogKey !== lastLoginSurfaceLogKey) {
            lastLoginSurfaceLogKey = loginSurfaceLogKey;
            log(
              "主线:完成",
              "拼多多登录",
              "登录界面检测",
              `店铺「${displayName}」已识别登录界面，页面=${page.url()}，${describePddLoginSurfaceState(loginSurfaces[0].state)}`
            );
          }

          for (const { surface } of loginSurfaces) {
            const autofillResult = await tryAutofillPddSurfaceOnce(
              surface,
              { username, password },
              autofilledSurfaceMarks
            );
            if (autofillResult.filled) {
              log("主线:完成", "拼多多登录", "自动填充", `店铺「${displayName}」账号密码已写入，并已尝试点击登录按钮；如出现验证码或滑块请人工完成`);
              break;
            }
            if (autofillResult.switched) {
              log("主线:完成", "拼多多登录", "账号登录", `店铺「${displayName}」已切换到账号登录，等待输入框稳定`);
            }
          }
        }
      }

      await wait(Math.min(PDD_LOGIN_ASSIST_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    }

    throw new Error("拼多多登录辅助超时，5 分钟内未检测到可填充的登录页或登录成功状态。");
  } finally {
    await disconnectFromChrome(browser, "拼多多登录辅助已完成，主动断开调试连接");
  }
}

module.exports = {
  buildPddLoginAssistRunnerOptions,
  getPddLoginAssistPollIntervalMs,
  shouldStopPddLoginAssist,
  notifyPddLoginReady,
  finishPddAssistIfAlreadyReady,
  runPddLoginAssist
};
