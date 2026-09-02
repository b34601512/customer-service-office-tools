// 该文件只负责天猫整店汇总需要的窗口和登录准备。
const { waitForChromeDebugPortReady, readManagedChromeSession } = require("../engine/chromeSession");
const { runManagedOpenWindowEngine, resolveManagedOpenWindowMeta } = require("../shared/managedOpenWindowEngine");

function buildManualDateRangeConfig(dateRange) {
  // 这个函数只把本轮真实日期转换成平台统一的手动日期配置。
  return {
    start: { type: "custom_date", offsetDays: 0, customDate: dateRange.startText },
    end: { type: "custom_date", offsetDays: 0, customDate: dateRange.endText }
  };
}

async function isManagedBrowserReadyForStore(platformKey, storeKey) {
  // 这个函数只判断当前受控窗口是否属于目标店铺。
  if (!(await waitForChromeDebugPortReady({ timeoutMs: 1000, pollIntervalMs: 100 }))) {
    return false;
  }
  const session = readManagedChromeSession();
  return session?.platformKey === platformKey && session?.storeKey === storeKey;
}

function notifyProgress(onProgress, patch) {
  // 这个函数只发送当前天猫窗口准备动作。
  if (typeof onProgress === "function") {
    onProgress({ updatedAt: new Date().toISOString(), ...patch });
  }
}

async function ensureTmallSummaryWindow(options = {}) {
  // 这个函数只在确实需要下载且当前不是本店窗口时打开天猫。
  const { store, onProgress, evidenceFiles } = options;
  if (await isManagedBrowserReadyForStore("tmall", store.key)) {
    return false;
  }
  const openMeta = resolveManagedOpenWindowMeta(store);
  if (!openMeta.openUrl) {
    throw new Error(`天猫店铺「${store.displayName || store.key}」缺少下载目标页。`);
  }
  notifyProgress(onProgress, {
    status: "running",
    action: "打开后台页面",
    detail: `正在打开「${store.displayName}」下载目标页。`,
    evidenceFiles
  });
  await runManagedOpenWindowEngine({
    platformKey: "tmall",
    storeConfig: store,
    openMeta,
    actionName: "汇总前打开后台页面",
    missingOpenUrlMessage: `天猫店铺「${store.displayName || store.key}」缺少下载目标页。`
  });
  notifyProgress(onProgress, {
    status: "running",
    action: "等待登录",
    detail: `已打开「${store.displayName}」窗口；下载主流程将按页面状态完成登录。`,
    evidenceFiles
  });
  return true;
}

module.exports = {
  buildManualDateRangeConfig,
  ensureTmallSummaryWindow
};
