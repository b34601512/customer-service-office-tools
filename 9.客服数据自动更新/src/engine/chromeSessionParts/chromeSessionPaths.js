// 该文件用于解决受控 Chrome 路径、资料目录和会话元信息管理问题。
const fs = require("fs");
const appConfig = require("../../config/appConfig");
const { initializeRuntimeLayout } = require("../../config/runtimeLayoutService");
const { ensureDir, movePathToBackup } = require("../fileSystem");
const { writeJsonFileAtomic, readJsonFile } = require("../../shared/fileStore");

function resolveChromePath() {
  // 这里显式检查 Chrome 路径，找不到就立刻报错，避免黑箱失败。
  for (const chromePath of appConfig.chromePaths) {
    if (chromePath && fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  throw new Error("未找到可用的浏览器，请先安装 Google Chrome 或 Microsoft Edge。");
}

function prepareRuntimeDirs() {
  // 这里集中初始化运行目录，后面浏览器、快照、下载都走同一套路径。
  initializeRuntimeLayout();
  ensureDir(appConfig.chromeUserDataDir);
  ensureDir(appConfig.storeChromeProfilesRoot);
}

function resolveManagedChromeUserDataDir(options = {}) {
  // 这里统一解析受控 Chrome 要使用的资料目录，默认仍走共享目录，支持按店铺独立隔离。
  const userDataDir = String(options.userDataDir || "").trim();
  return userDataDir || appConfig.chromeUserDataDir;
}

function buildManagedChromeMatchTokens() {
  // 这里用统一根目录识别所有受控登录浏览器，兼容共享目录和按店铺拆分后的独立目录。
  return [
    `--remote-debugging-port=${appConfig.tmall.remoteDebuggingPort}`,
    `--user-data-dir=${appConfig.runtime.state.browserProfilesRoot}`
  ];
}

function buildManagedChromeSessionMeta(options = {}) {
  // 这里把受控浏览器当前绑定的平台、店铺和目录固化下来，供状态轮询和切店重建复用。
  return {
    platformKey: String(options.platformKey || "").trim(),
    storeKey: String(options.storeKey || "").trim(),
    storeDisplayName: String(options.storeDisplayName || "").trim(),
    accountProfileKey: String(options.accountProfileKey || "").trim(),
    userDataDir: resolveManagedChromeUserDataDir(options),
    targetUrl: String(options.targetUrl || "").trim(),
    remoteDebuggingPort: appConfig.tmall.remoteDebuggingPort,
    recordedAt: new Date().toISOString()
  };
}

function writeManagedChromeSession(meta) {
  writeJsonFileAtomic(appConfig.chromeSessionPath, meta);
}

function readManagedChromeSession() {
  if (!fs.existsSync(appConfig.chromeSessionPath)) {
    return null;
  }

  return readJsonFile(appConfig.chromeSessionPath, "受控浏览器会话信息");
}

function clearManagedChromeSession() {
  if (fs.existsSync(appConfig.chromeSessionPath)) {
    movePathToBackup(appConfig.chromeSessionPath, appConfig.backupRootDir, "浏览器会话状态");
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  resolveChromePath,
  prepareRuntimeDirs,
  resolveManagedChromeUserDataDir,
  buildManagedChromeMatchTokens,
  buildManagedChromeSessionMeta,
  writeManagedChromeSession,
  readManagedChromeSession,
  clearManagedChromeSession,
  wait
};
