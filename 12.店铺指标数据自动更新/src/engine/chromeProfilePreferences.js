const fs = require("fs");
const path = require("path");
const { ensureDir } = require("./fileSystem");
const { readJsonFile, writeJsonFileAtomic } = require("../shared/fileStore");

function resolveChromeDefaultProfileDir(userDataDir) {
  // 这里统一锁定 Chrome 默认资料目录，手工打开窗口和自动流程都写同一份偏好。
  const normalizedUserDataDir = String(userDataDir || "").trim();
  if (!normalizedUserDataDir) {
    throw new Error("写入 Chrome 下载偏好失败：缺少浏览器资料目录。");
  }

  return path.join(normalizedUserDataDir, "Default");
}

function resolveChromePreferencesPath(userDataDir) {
  return path.join(resolveChromeDefaultProfileDir(userDataDir), "Preferences");
}

function readChromePreferences(userDataDir) {
  const preferencesPath = resolveChromePreferencesPath(userDataDir);
  if (!fs.existsSync(preferencesPath)) {
    return {};
  }

  return readJsonFile(preferencesPath, "Chrome 偏好配置");
}

function applyChromeDownloadPreferences(userDataDir, downloadDir) {
  // 这里在浏览器启动前先把默认下载目录写进资料目录，保证后续人工点击也落到可见目录。
  const normalizedDownloadDir = String(downloadDir || "").trim();
  if (!normalizedDownloadDir) {
    throw new Error("写入 Chrome 下载偏好失败：缺少下载目录。");
  }

  const defaultProfileDir = resolveChromeDefaultProfileDir(userDataDir);
  ensureDir(defaultProfileDir);
  const preferencesPath = resolveChromePreferencesPath(userDataDir);
  const preferences = readChromePreferences(userDataDir);
  preferences.download = {
    ...(preferences.download || {}),
    default_directory: normalizedDownloadDir,
    prompt_for_download: false,
    directory_upgrade: true
  };
  writeJsonFileAtomic(preferencesPath, preferences);
  return preferencesPath;
}

module.exports = {
  applyChromeDownloadPreferences
};
