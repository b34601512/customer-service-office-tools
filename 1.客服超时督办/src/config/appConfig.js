const path = require("path");
const { readAppRuntimeConfig, DEFAULT_TARGET_URL } = require("./appRuntimeConfig");
const { resolveCurrentDiskBackupRoot } = require("./backupRoot");

const projectRoot = path.resolve(__dirname, "..", "..");
const projectConfigDir = path.join(projectRoot, "project-config");
const appRuntimeConfigPath = path.join(projectConfigDir, "app-config.json");
const appRuntimeConfig = readAppRuntimeConfig(appRuntimeConfigPath);
const runtimeDir = path.join(projectRoot, "runtime");
const userDataDir = path.join(runtimeDir, "edge-user-data");
const controlCenterUserDataDir = path.join(runtimeDir, "edge-control-center");

module.exports = {
  targetUrl: appRuntimeConfig.targetUrl,
  scheduleUrl: appRuntimeConfig.scheduleUrl,
  managerStaffName: appRuntimeConfig.managerStaffName,
  defaultTargetUrl: DEFAULT_TARGET_URL,
  projectRoot,
  projectConfigDir,
  appRuntimeConfigPath,
  runtimeDir,
  backupRoot: resolveCurrentDiskBackupRoot(projectRoot),
  userDataDir,
  controlCenterUserDataDir,
  runtimeProfileName: "Default",
  runHeadless: true,
  replyConfigPath: path.join(projectConfigDir, "reply-config.js"),
  wecomRobotConfigPath: path.join(projectConfigDir, "wecom-robot.json"),
  supervisionProcessStatePath: path.join(runtimeDir, "supervision", "process-records.json"),
  timeoutPerformanceLedgerPath: path.join(runtimeDir, "timeout-performance", "ledger.jsonl"),
  loginStatusPath: path.join(userDataDir, "supervisor-login-status.json"),
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
  edgePaths: [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map((root) => path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"))
};
