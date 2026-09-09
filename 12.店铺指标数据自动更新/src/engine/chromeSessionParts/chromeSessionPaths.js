// 该文件用于解决受控 Edge 路径、资料目录和会话元信息管理问题；保留历史文件名以兼容既有运行目录。
const fs = require("fs");
const appConfig = require("../../config/appConfig");
const { initializeRuntimeLayout } = require("../../config/runtimeLayoutService");
const { ensureDir, movePathToBackup } = require("../fileSystem");
const { writeJsonFileAtomic, readJsonFile } = require("../../shared/fileStore");

function resolveEdgePath() {
  // 这里显式检查 Edge 路径，找不到就立刻报错，避免黑箱失败。
  for (const edgePath of appConfig.edgePaths) {
    if (edgePath && fs.existsSync(edgePath)) {
      return edgePath;
    }
  }

  throw new Error("未找到可用的 Microsoft Edge，请先安装或启用 Edge。");
}

function prepareRuntimeDirs() {
  // 这里集中初始化运行目录，后面浏览器、快照、下载都走同一套路径。
  initializeRuntimeLayout();
  ensureDir(appConfig.chromeUserDataDir);
  ensureDir(appConfig.storeChromeProfilesRoot);
}

function resolveManagedChromeUserDataDir(options = {}) {
  // 这里统一解析受控 Edge 要使用的资料目录，默认仍走共享目录，支持按店铺独立隔离。
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
  // 这里把受控 Edge 当前绑定的平台、店铺、模式和目录固化下来，供状态轮询和切店重建复用。
  return {
    platformKey: String(options.platformKey || "").trim(),
    storeKey: String(options.storeKey || "").trim(),
    storeDisplayName: String(options.storeDisplayName || "").trim(),
    accountProfileKey: String(options.accountProfileKey || "").trim(),
    userDataDir: resolveManagedChromeUserDataDir(options),
    targetUrl: String(options.targetUrl || "").trim(),
    headless: options.headless === true,
    browserMode: String(options.browserMode || (options.headless === true ? "headless" : "headed")),
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
  resolveEdgePath,
  prepareRuntimeDirs,
  resolveManagedChromeUserDataDir,
  buildManagedChromeMatchTokens,
  buildManagedChromeSessionMeta,
  writeManagedChromeSession,
  readManagedChromeSession,
  clearManagedChromeSession,
  wait
};
