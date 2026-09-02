const { waitForChromeDebugPortReady, readManagedChromeSession } = require("../../engine/chromeSession");
const { resolveManagedOpenWindowMeta, runManagedOpenWindowEngine } = require("../../shared/managedOpenWindowEngine");
const { startJdLoginAssist } = require("../../platforms/jd/jdLoginAssist");
const { startPddLoginAssist } = require("../../platforms/pdd/pddLoginAssist");
const { notifySummaryTaskProgress } = require("./summaryTaskProgress");

async function resolveManagedBrowserReadinessForStore(platformKey, storeKey, dependencies = {}) {
  // 这个函数只判断当前受控浏览器是否确实属于目标店铺。
  const waitForPort = dependencies.waitForChromeDebugPortReady || waitForChromeDebugPortReady;
  const readSession = dependencies.readManagedChromeSession || readManagedChromeSession;
  if (!(await waitForPort({ timeoutMs: 1000, pollIntervalMs: 100 }))) {
    return { ready: false, reason: "调试浏览器端口未连接，请先打开当前店铺窗口。" };
  }
  const session = readSession();
  if (!session) {
    return { ready: false, reason: "没有读取到受控浏览器会话，请重新打开当前店铺窗口。" };
  }
  if (session.platformKey !== platformKey || session.storeKey !== storeKey) {
    return { ready: false, reason: `当前窗口属于「${session.platformKey || "未知平台"}:${session.storeKey || "未知店铺"}」，不是本店。` };
  }
  return { ready: true, reason: "当前店铺已有可接管窗口。" };
}

function resolveSummaryLoginAssistStarter(platformKey, dependencies = {}) {
  // 这个函数只返回京东或拼多多对应的登录辅助入口。
  if (typeof dependencies.startLoginAssist === "function") {
    return dependencies.startLoginAssist;
  }
  if (platformKey === "jd") {
    return startJdLoginAssist;
  }
  if (platformKey === "pdd") {
    return startPddLoginAssist;
  }
  return null;
}

async function openPlatformStoreWindowForSummary(input, dependencies = {}) {
  // 这个函数只为确实需要下载的店铺打开官方下载目标页。
  const { task, resolvedConfig, onTaskProgress } = input;
  const resolveOpenMeta = dependencies.resolveManagedOpenWindowMeta || resolveManagedOpenWindowMeta;
  const runOpenEngine = dependencies.runManagedOpenWindowEngine || runManagedOpenWindowEngine;
  const waitForPort = dependencies.waitForChromeDebugPortReady || waitForChromeDebugPortReady;
  const startLoginAssist = resolveSummaryLoginAssistStarter(task.platformKey, dependencies);
  const openMeta = resolveOpenMeta(resolvedConfig.activeStore);
  notifySummaryTaskProgress(task, onTaskProgress, {
    status: "running",
    action: "打开后台页面",
    detail: `正在打开「${task.storeDisplayName}」下载目标页。`
  });
  await runOpenEngine({
    platformKey: task.platformKey,
    storeConfig: resolvedConfig.activeStore,
    openMeta,
    actionName: "批量汇总打开后台页面",
    moduleName: "批量汇总",
    missingOpenUrlMessage: `当前${task.platformLabel}店铺「${task.storeDisplayName}」缺少下载目标页。`,
    startAssist: startLoginAssist
      ? ({ forceRestart }) => startLoginAssist({ forceRestart, reportKey: resolvedConfig.reportKey, resolvedConfig })
      : null
  });
  notifySummaryTaskProgress(task, onTaskProgress, {
    status: "running",
    action: "等待浏览器就绪",
    detail: `已打开「${task.storeDisplayName}」窗口，正在等待调试端口。`
  });
  if (!(await waitForPort({ timeoutMs: 15000, pollIntervalMs: 200 }))) {
    throw new Error(`已打开「${task.storeDisplayName}」窗口，但 15 秒内没有检测到调试浏览器端口。`);
  }
}

async function ensurePlatformStoreWindowForSummary(input, dependencies = {}) {
  // 这个函数只在当前窗口不属于目标店铺时重新打开目标店铺窗口。
  const readiness = await resolveManagedBrowserReadinessForStore(
    input.task.platformKey,
    input.resolvedConfig.activeStore.key,
    dependencies
  );
  if (readiness.ready) {
    notifySummaryTaskProgress(input.task, input.onTaskProgress, {
      status: "running",
      action: "接管店铺窗口",
      detail: readiness.reason
    });
    return;
  }
  await openPlatformStoreWindowForSummary(input, dependencies);
}

module.exports = {
  ensurePlatformStoreWindowForSummary
};
