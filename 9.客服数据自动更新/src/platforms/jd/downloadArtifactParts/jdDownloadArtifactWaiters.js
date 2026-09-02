// 该文件用于解决京东下载开始和稳定文件落盘的状态等待问题。
const appConfig = require("../../../config/appConfig");
const { waitForDownloadArtifact } = require("../../../shared/downloadEventEngine");
const { findLatestNewDownloadArtifact } = require("./jdDownloadArtifactScanner");

async function waitForDownloadStart(downloadDir, beforeFiles, timeoutMs = 60000) {
  // 这里只等待运行目录出现本轮真实文件。
  return waitForDownloadArtifact({
    downloadDir,
    timeoutMs,
    pollIntervalMs: appConfig.jd.downloadStartPollIntervalMs,
    findNewArtifact: () => findLatestNewDownloadArtifact(downloadDir, beforeFiles),
    actionText: "点击京东导出"
  });
}

module.exports = {
  waitForDownloadStart
};
