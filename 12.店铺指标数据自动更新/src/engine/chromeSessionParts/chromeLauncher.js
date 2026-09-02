// 该文件用于解决可见调试 Chrome 拉起、默认下载目录设置和会话状态写入问题。
const { spawn } = require("child_process");
const appConfig = require("../../config/appConfig");
const { buildManagedChromeLaunchArgs } = require("../chromeLaunchArgs");
const { log } = require("../logger");
const { ensureDir } = require("../fileSystem");
const { applyChromeDownloadPreferences } = require("../chromeProfilePreferences");
const { migrateLegacyStoreChromeProfileToAccountDir } = require("../chromeProfileAccountMigration");
const { writeManagedPid } = require("../managedProcessParts/managedPidStore");
const { releaseDebugPort } = require("./chromePortGuard");
const {
  resolveChromePath,
  prepareRuntimeDirs,
  resolveManagedChromeUserDataDir,
  buildManagedChromeSessionMeta,
  writeManagedChromeSession
} = require("./chromeSessionPaths");

async function launchChromeForManualLogin(targetUrl, options = {}) {
  // 这里单独拉起可见 Chrome 并开启远程调试，方便用户手工登录后我再接管。
  prepareRuntimeDirs();
  const userDataDir = resolveManagedChromeUserDataDir(options);
  migrateLegacyStoreChromeProfileToAccountDir({
    userDataDir,
    accountProfileKey: options.accountProfileKey
  });
  ensureDir(userDataDir);
  const downloadDir = String(options.downloadDir || "").trim();
  if (downloadDir) {
    applyChromeDownloadPreferences(userDataDir, downloadDir);
  }
  const executablePath = resolveChromePath();
  const args = buildManagedChromeLaunchArgs({
    remoteDebuggingPort: appConfig.tmall.remoteDebuggingPort,
    userDataDir,
    targetUrl
  });

  // 启动前端口守卫：若调试端口仍被占用，先清理带调试标志的残留浏览器，避免新浏览器抢端口失败。
  const portReleased = await releaseDebugPort(appConfig.tmall.remoteDebuggingPort);
  if (!portReleased) {
    throw new Error(
      `调试端口 ${appConfig.tmall.remoteDebuggingPort} 仍被占用且无法自动清理，请先关闭占用该端口的程序后再试。`
    );
  }

  const child = spawn(executablePath, args, {
    detached: true,
    stdio: "ignore"
  });

  child.unref();
  writeManagedPid(appConfig.chromePidPath, child.pid);
  writeManagedChromeSession(
    buildManagedChromeSessionMeta({
      ...options,
      targetUrl,
      userDataDir
    })
  );
  log(
    "主线:启动",
    "浏览器引擎",
    "人工登录",
    `已拉起 Chrome，PID=${child.pid}，调试端口=${appConfig.tmall.remoteDebuggingPort}，资料目录=${userDataDir}，目标页=${targetUrl}，默认下载目录=${downloadDir || "沿用 Chrome 当前设置"}`
  );
}

module.exports = {
  launchChromeForManualLogin
};
