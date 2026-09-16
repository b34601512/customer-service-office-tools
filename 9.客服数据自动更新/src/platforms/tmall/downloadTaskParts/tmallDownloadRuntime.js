const fs = require("fs");
const appConfig = require("../../../config/appConfig");
const { log } = require("../../../engine/logger");
const { waitForDownloadArtifact } = require("../../../shared/downloadEventEngine");
const { findLatestNewDownloadArtifact } = require("../tmallDownloadArtifacts");

async function waitForTmallDownloadStart(downloadDir, beforeFiles, timeoutMs = 60000) {
  // 这个函数只等待真实下载文件出现。
  return waitForDownloadArtifact({
    downloadDir,
    timeoutMs,
    pollIntervalMs: appConfig.tmall.downloadStartPollIntervalMs,
    findNewArtifact: () => findLatestNewDownloadArtifact(downloadDir, beforeFiles),
    actionText: "点击天猫下载"
  });
}

async function setTmallDownloadDirectory(page, downloadDir) {
  // 这个函数只把当前页面的浏览器下载目录切换到指定目录。
  fs.mkdirSync(downloadDir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir
  });
}

function reportTmallDownloadProgress(onProgress, stageText, detail = "") {
  // 这个函数只记录并回传一个下载阶段。
  log("主线:执行", "天猫下载", stageText, detail || "已进入该阶段");
  if (typeof onProgress === "function") {
    onProgress(stageText, detail);
  }
}

module.exports = {
  waitForTmallDownloadStart,
  setTmallDownloadDirectory,
  reportTmallDownloadProgress
};
