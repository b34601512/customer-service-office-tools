const path = require("path");
const { readAppRuntimeConfig, DEFAULT_TARGET_URL } = require("./appRuntimeConfig");
const { resolveCurrentDiskBackupRoot } = require("./backupRoot");

const projectRoot = path.resolve(__dirname, "..", "..");
const projectConfigDir = path.join(projectRoot, "project-config");
const appRuntimeConfigPath = path.join(projectConfigDir, "app-config.json");
const appRuntimeConfig = readAppRuntimeConfig(appRuntimeConfigPath);
const runtimeDir = path.join(projectRoot, "runtime");
const userDataDir = path.join(runtimeDir, "chrome-user-data");
const controlCenterUserDataDir = path.join(runtimeDir, "control-center-browser");
const legacyBrowserDataDirs = [
  path.join(runtimeDir, "chrome-profile")
];

module.exports = {
  targetUrl: appRuntimeConfig.targetUrl,
  defaultTargetUrl: DEFAULT_TARGET_URL,
  projectRoot,
  projectConfigDir,
  appRuntimeConfigPath,
  runtimeDir,
  backupRoot: resolveCurrentDiskBackupRoot(projectRoot),
  userDataDir,
  controlCenterUserDataDir,
  legacyBrowserDataDirs,
  runtimeProfileName: "Default",
  runHeadless: false,
  replyConfigPath: path.join(projectConfigDir, "reply-config.js"),
  wecomRobotConfigPath: path.join(projectConfigDir, "wecom-robot.json"),
  supervisionProcessStatePath: path.join(runtimeDir, "supervision", "process-records.json"),
  timeoutPerformanceLedgerPath: path.join(runtimeDir, "timeout-performance", "ledger.jsonl"),
  loginStatusPath: path.join(runtimeDir, "login-status.json"),
  transferMonitorStatePath: path.join(runtimeDir, "transfer-monitor", "state.json"),
  missedReplyMonitorStatePath: path.join(runtimeDir, "missed-reply-monitor", "state.json"),
  onlinePresenceStatePath: path.join(runtimeDir, "online-presence-monitor", "state.json"),
  offDutyStatePath: path.join(runtimeDir, "off-duty-close", "state.json"),
  runtimeMaintenanceIntervalMs: 30 * 60 * 1000,
  runtimeMaintenanceLogMaxBytes: 5 * 1024 * 1024,
  runtimeMaintenanceLogKeepBytes: 2 * 1024 * 1024,
  runtimeMaintenanceStateRetentionDays: 35,
  runtimeMaintenanceMaxStateEntries: 800,
  browserDiskCacheSizeBytes: 10 * 1024 * 1024,
  controlCenterBrowserDiskCacheSizeBytes: 1024 * 1024,
  defaultTimeout: 30000,
  pageReadyTimeout: 60000,
  workbenchReadyTimeout: 20000,
  chromePaths: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    )
  ]
};
