// 该文件用于解决当前 runtime 状态、产出和缓存目录的唯一布局问题。
const path = require("path");
const {
  buildStoreAccountChromeProfileKey,
  buildStoreScopedChromeProfileKey,
  joinStoreAccountChromeUserDataDir
} = require("./runtimeBrowserProfilePaths");

function joinPlatformDir(rootPath, platformKey) {
  return path.join(rootPath, String(platformKey || "").trim());
}

function joinStoreDir(rootPath, platformKey, storeKey) {
  return path.join(rootPath, String(platformKey || "").trim(), String(storeKey || "").trim());
}

function createRuntimeLayout(projectRoot) {
  const runtimeRoot = path.join(projectRoot, "runtime");
  const stateRoot = path.join(runtimeRoot, "state");
  const outputRoot = path.join(runtimeRoot, "output");
  const cacheRoot = path.join(runtimeRoot, "cache");
  const browserProfilesRoot = path.join(stateRoot, "browser-profiles");
  const processRoot = path.join(stateRoot, "process");
  const historyRoot = path.join(stateRoot, "history");
  const downloadsRoot = path.join(outputRoot, "downloads");
  const snapshotsRoot = path.join(cacheRoot, "snapshots");
  const downloadRunsRoot = path.join(cacheRoot, "download-runs");

  return {
    root: runtimeRoot,
    stateRoot,
    outputRoot,
    cacheRoot,
    state: {
      browserProfilesRoot,
      browserProfiles: {
        chromeUserDataDir: path.join(browserProfilesRoot, "chrome-user-data"),
        storeChromeProfilesRoot: path.join(browserProfilesRoot, "store-chrome-profiles")
      },
      buildStoreAccountChromeProfileKey,
      buildStoreScopedChromeProfileKey,
      getStoreAccountChromeProfileKey(platformKey, storeKey, username) {
        return buildStoreScopedChromeProfileKey(platformKey, storeKey, username);
      },
      getStoreAccountChromeUserDataDir(platformKey, storeKey, username) {
        return joinStoreAccountChromeUserDataDir(
          path.join(browserProfilesRoot, "store-chrome-profiles"),
          platformKey,
          storeKey,
          username
        );
      },
      processRoot,
      process: {
        chromePidPath: path.join(processRoot, "chrome.pid"),
        chromeSessionPath: path.join(processRoot, "chrome-session.json")
      },
      historyRoot,
      history: {
        taskHistoryPath: path.join(historyRoot, "task-history.json"),
        kdocsSyncReceiptPath: path.join(historyRoot, "kdocs-sync-receipts.json")
      }
    },
    output: {
      downloadsRoot,
      downloads: {
        tmall: joinPlatformDir(downloadsRoot, "tmall"),
        jd: joinPlatformDir(downloadsRoot, "jd"),
        pdd: joinPlatformDir(downloadsRoot, "pdd")
      },
      getPlatformDownloadDir(platformKey) {
        return joinPlatformDir(downloadsRoot, platformKey);
      },
      getStoreDownloadDir(platformKey, storeKey) {
        return joinStoreDir(downloadsRoot, platformKey, storeKey);
      }
    },
    cache: {
      snapshotsRoot,
      snapshots: {
        tmall: joinPlatformDir(snapshotsRoot, "tmall")
      },
      downloadRunsRoot,
      getPlatformSnapshotDir(platformKey) {
        return joinPlatformDir(snapshotsRoot, platformKey);
      },
      getPlatformDownloadRunDir(platformKey) {
        return joinPlatformDir(downloadRunsRoot, platformKey);
      },
      getStoreDownloadRunDir(platformKey, storeKey) {
        return joinStoreDir(downloadRunsRoot, platformKey, storeKey);
      }
    }
  };
}

module.exports = { createRuntimeLayout };
