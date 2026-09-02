const appConfig = require("../config/appConfig");
const { cleanActiveStoreBrowserCachesWhenSafe } = require("../config/runtimeLayoutService");
const { launchChromeForManualLogin, closeManagedChrome } = require("../engine/chromeSession");
const { log, logError } = require("../engine/logger");

function normalizeText(value) {
  return String(value || "").trim();
}

function resolveBrowserProfileStoreKey(platformKey, storeKey) {
  // 抖音同一登录账号可管理多店，资料目录按账号共享；其他平台继续严格按店隔离。
  return platformKey === "douyin" ? "shared-login-account" : storeKey;
}

function resolveManagedOpenWindowMeta(storeConfig) {
  // 这里统一直接打开官方下载目标页，登录页由平台自身按未登录状态跳转。
  const siteUrl = normalizeText(storeConfig?.siteUrl);
  return {
    openUrl: siteUrl,
    siteUrl
  };
}

function buildManagedOpenWindowPlan(options = {}) {
  // 这里先把打开窗口所需上下文一次算清楚，后续所有入口都复用同一份执行计划。
  const platformKey = normalizeText(options.platformKey);
  if (!platformKey) {
    throw new Error("执行打开后台页面引擎失败：缺少平台标识。");
  }

  const storeConfig = options.storeConfig || null;
  if (!storeConfig) {
    throw new Error(`执行打开登录窗口引擎失败：平台「${platformKey}」缺少店铺配置。`);
  }

  const storeKey = normalizeText(storeConfig.key);
  if (!storeKey) {
    throw new Error(`执行打开登录窗口引擎失败：平台「${platformKey}」缺少店铺标识。`);
  }

  const storeDisplayName = normalizeText(storeConfig.displayName || storeKey) || "当前店铺";
  const openMeta = options.openMeta || resolveManagedOpenWindowMeta(storeConfig);
  if (!normalizeText(openMeta.openUrl)) {
    throw new Error(options.missingOpenUrlMessage || `当前店铺缺少可打开地址：${storeDisplayName}`);
  }

  const browserProfileStoreKey = resolveBrowserProfileStoreKey(platformKey, storeKey);
  const accountProfileKey = appConfig.getStoreAccountChromeProfileKey(
    platformKey,
    browserProfileStoreKey,
    storeConfig.username
  );
  const userDataDir = normalizeText(
    options.userDataDir ||
      appConfig.getStoreAccountChromeUserDataDir(
        platformKey,
        browserProfileStoreKey,
        storeConfig.username
      )
  );
  if (!userDataDir) {
    throw new Error(`执行打开登录窗口引擎失败：店铺「${storeDisplayName}」缺少浏览器资料目录。`);
  }

  const hasCredentials = Boolean(
    normalizeText(storeConfig.username) && normalizeText(storeConfig.password)
  );

  return {
    platformKey,
    storeConfig,
    storeKey,
    browserProfileStoreKey,
    storeDisplayName,
    openMeta,
    accountProfileKey,
    userDataDir,
    hasCredentials
  };
}

function buildDefaultStartLogMessage(plan) {
  return `店铺=${plan.storeDisplayName}，账号目录=${plan.accountProfileKey}，目标页=${plan.openMeta.siteUrl || "未配置"}，资料目录=${plan.userDataDir}`;
}

function buildDefaultCompleteLogMessage(result) {
  return `店铺=${result.storeDisplayName}，账号目录=${result.accountProfileKey}，资料目录=${result.userDataDir}，辅助流程=${result.assistStarted ? "已重启" : "未启动"}`;
}

async function runManagedOpenWindowEngine(options = {}, dependencies = {}) {
  // 这里把“关闭当前浏览器 -> 拉起新浏览器 -> 重启辅助流程”收口成统一引擎，保证重复点击永远重走完整链路。
  const plan = buildManagedOpenWindowPlan(options);
  const logFn = dependencies.logFn || log;
  const logErrorFn = dependencies.logErrorFn || logError;
  const closeManagedChromeFn = dependencies.closeManagedChrome || closeManagedChrome;
  const cleanStoreBrowserCachesFn =
    dependencies.cleanStoreBrowserCaches || cleanActiveStoreBrowserCachesWhenSafe;
  const launchChromeForManualLoginFn =
    dependencies.launchChromeForManualLogin || launchChromeForManualLogin;
  const normalizedActionName = normalizeText(options.actionName || "打开后台页面请求") || "打开后台页面请求";
  const moduleName = normalizeText(options.moduleName || "店铺浏览器") || "店铺浏览器";
  const startLogMessage =
    typeof options.buildStartLogMessage === "function"
      ? options.buildStartLogMessage(plan)
      : buildDefaultStartLogMessage(plan);

  logFn("主线:执行", moduleName, normalizedActionName, startLogMessage);
  await closeManagedChromeFn();
  cleanStoreBrowserCachesFn(plan.userDataDir, "打开后台页面前自动清理");
  await launchChromeForManualLoginFn(plan.openMeta.openUrl, {
    userDataDir: plan.userDataDir,
    accountProfileKey: plan.accountProfileKey,
    platformKey: plan.platformKey,
    storeKey: plan.storeKey,
    storeDisplayName: plan.storeDisplayName,
    downloadDir: plan.storeConfig.downloadDir
  });

  let assistStarted = false;
  if (typeof options.startAssist === "function") {
    const shouldStartAssist =
      typeof options.shouldStartAssist === "function"
        ? Boolean(options.shouldStartAssist(plan))
        : true;
    if (shouldStartAssist) {
      // 这里故意只负责启动辅助线程，不等待登录成功，避免开窗动作被后台轮询拖住。
      const assistPromise = Promise.resolve(
        options.startAssist({
          forceRestart: true,
          plan
        })
      );
      assistPromise.catch((error) => {
        const assistModuleName = plan.platformKey === "jd"
          ? "京东登录"
          : plan.platformKey === "pdd"
            ? "拼多多登录"
            : plan.platformKey === "douyin"
              ? "抖音登录"
              : "天猫登录";
        logErrorFn("主线:失败", assistModuleName, "后台辅助启动", error);
      });
      assistStarted = true;
    }
  }

  const result = {
    ...plan,
    assistStarted
  };

  if (typeof options.afterOpen === "function") {
    await Promise.resolve(options.afterOpen(result));
  }

  const completeLogMessage =
    typeof options.buildCompleteLogMessage === "function"
      ? options.buildCompleteLogMessage(result)
      : buildDefaultCompleteLogMessage(result);
  logFn("主线:完成", moduleName, normalizedActionName, completeLogMessage);
  return result;
}

module.exports = {
  resolveManagedOpenWindowMeta,
  resolveBrowserProfileStoreKey,
  runManagedOpenWindowEngine
};
