const { ensureDir } = require("../../../engine/fileSystem");
const { log } = require("../../../engine/logger");
const { waitForDownloadArtifact } = require("../../../shared/downloadEventEngine");
const { listPddDownloadArtifacts } = require("./pddDownloadArtifacts");

const PDD_DOWNLOAD_TIMEOUT_MS = 60000;
const PDD_DOWNLOAD_POLL_INTERVAL_MS = 1000;

async function waitForPddDownloadStart(downloadDir, beforeFiles, timeoutMs = PDD_DOWNLOAD_TIMEOUT_MS) {
  // 这个函数只等待店铺目录出现本轮真实文件。
  return waitForDownloadArtifact({
    downloadDir,
    timeoutMs,
    pollIntervalMs: PDD_DOWNLOAD_POLL_INTERVAL_MS,
    findNewArtifact: () => listPddDownloadArtifacts(downloadDir).find((item) => !beforeFiles.has(item.name)),
    actionText: "点击拼多多下载表单"
  });
}

async function setPddDownloadDirectory(page, downloadDir) {
  // 这个函数只把浏览器下载目录设置为当前拼多多店铺目录。
  ensureDir(downloadDir);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir
  });
}

function reportPddDownloadProgress(onProgress, stageText, detail = "") {
  // 这个函数只记录并回传一个拼多多下载阶段。
  log("主线:执行", "拼多多下载", stageText, detail || "已进入该阶段");
  if (typeof onProgress === "function") {
    onProgress(stageText, detail);
  }
}

module.exports = {
  PDD_DOWNLOAD_TIMEOUT_MS,
  waitForPddDownloadStart,
  setPddDownloadDirectory,
  reportPddDownloadProgress
};
