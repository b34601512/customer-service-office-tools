const path = require("path");
const { createRuntimeLayout } = require("./runtimePathParts/currentRuntimeLayout");

const projectRoot = path.resolve(__dirname, "..", "..");
const projectDriveRoot = path.parse(projectRoot).root;
const backupRootDir = path.join(projectDriveRoot, "备份文件夹");
const runtime = createRuntimeLayout(projectRoot);

module.exports = {
  projectRoot,
  backupRootDir,
  runtime,
  projectConfigPath: path.join(projectRoot, "project-config", "platform-config.json"),
  taskHistoryPath: runtime.state.history.taskHistoryPath,
  kdocsSyncReceiptPath: runtime.state.history.kdocsSyncReceiptPath,
  chromeUserDataDir: runtime.state.browserProfiles.chromeUserDataDir,
  storeChromeProfilesRoot: runtime.state.browserProfiles.storeChromeProfilesRoot,
  chromePidPath: runtime.state.process.chromePidPath,
  chromeSessionPath: runtime.state.process.chromeSessionPath,
  buildStoreAccountChromeProfileKey(username) {
    return runtime.state.buildStoreAccountChromeProfileKey(username);
  },
  getStoreAccountChromeProfileKey(platformKey, storeKey, username) {
    return runtime.state.getStoreAccountChromeProfileKey(platformKey, storeKey, username);
  },
  getStoreAccountChromeUserDataDir(platformKey, storeKey, username) {
    return runtime.state.getStoreAccountChromeUserDataDir(platformKey, storeKey, username);
  },
  getStoreDownloadDir(platformKey, storeKey) {
    return runtime.output.getStoreDownloadDir(platformKey, storeKey);
  },
  getStoreDownloadRunDir(platformKey, storeKey) {
    return runtime.cache.getStoreDownloadRunDir(platformKey, storeKey);
  },
  chromePaths: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe")
  ],
  tmall: {
    siteUrl: "https://sycm.taobao.com/qos/service/frame/customer/performance/new#/user",
    // 调试端口不用 9222：它同时是 Chrome DevTools 默认端口，本机普通 Edge/其他自动化工具
    // 都可能占用它，导致受控浏览器启动即冲突。改用不常用端口从源头避免撞车。
    remoteDebuggingPort: 9333,
    cdpEndpoint: "http://127.0.0.1:9333",
    snapshotDir: runtime.cache.getPlatformSnapshotDir("tmall"),
    downloadDir: runtime.output.getPlatformDownloadDir("tmall"),
    downloadRunDir: runtime.cache.getPlatformDownloadRunDir("tmall"),
    connectTimeoutMs: 180000,
    actionPollIntervalMs: 1500,
    minimumClickIntervalMs: 4500,
    datePollIntervalMs: 1500,
    dateRetryCooldownMs: 15000,
    downloadStartPollIntervalMs: 1500,
    downloadFilePollIntervalMs: 2000,
    pageReadyPollIntervalMs: 2000,
    storeOptionPollIntervalMs: 1500,
    loginReadyPollIntervalMs: 8000,
    loginActionPollIntervalMs: 300,
    loginClickIntervalMs: 500,
    openAlignmentPollIntervalMs: 5000
  },
  jd: {
    downloadDir: runtime.output.getPlatformDownloadDir("jd"),
    downloadRunDir: runtime.cache.getPlatformDownloadRunDir("jd"),
    downloadStartPollIntervalMs: 1500,
    downloadFilePollIntervalMs: 2000
  },
  pdd: {
    downloadDir: runtime.output.getPlatformDownloadDir("pdd"),
    downloadRunDir: runtime.cache.getPlatformDownloadRunDir("pdd")
  }
};
