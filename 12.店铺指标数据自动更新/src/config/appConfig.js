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
  // 调试端口统一用 9334：不用 9222(Chrome DevTools 默认端口，本机普通 Edge/其他自动化工具都可能占用)，
  // 且与「9.客服数据自动更新」的 9333 保持独立，两个项目可同时运行互不冲突。
  tmall: {
    siteUrl: "https://qn.taobao.com/home.html/voc-tmall/serverReport",
    remoteDebuggingPort: 9334,
    cdpEndpoint: "http://127.0.0.1:9334",
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
    siteUrl: "https://mms.pinduoduo.com/sycm/goods_quality/customer",
    remoteDebuggingPort: 9334,
    cdpEndpoint: "http://127.0.0.1:9334",
    snapshotDir: runtime.cache.getPlatformSnapshotDir("pdd"),
    downloadDir: runtime.output.getPlatformDownloadDir("pdd"),
    downloadRunDir: runtime.cache.getPlatformDownloadRunDir("pdd"),
    connectTimeoutMs: 300000,
    actionPollIntervalMs: 1000,
    loginReadyPollIntervalMs: 1000,
    loginActionPollIntervalMs: 500,
    pageReadyPollIntervalMs: 1500,
    openAlignmentPollIntervalMs: 5000
  },
  douyin: {
    siteUrl: "https://fxg.jinritemai.com/ffa/eco/experience-score?source=fxg-home&btm_ppre=a0.b0.c0.d0&btm_pre=..c0.c0",
    merchantHomeUrl: "https://fxg.jinritemai.com/ffa/mshop/homepage/index",
    loginUrl: "https://fxg.jinritemai.com/login/common",
    remoteDebuggingPort: 9334,
    cdpEndpoint: "http://127.0.0.1:9334",
    snapshotDir: runtime.cache.getPlatformSnapshotDir("douyin"),
    downloadDir: runtime.output.getPlatformDownloadDir("douyin"),
    downloadRunDir: runtime.cache.getPlatformDownloadRunDir("douyin"),
    connectTimeoutMs: 600000,
    pageReadyPollIntervalMs: 1000,
    storeSwitchTimeoutMs: 600000,
    loginRecoveryTimeoutMs: 600000
  }
};
