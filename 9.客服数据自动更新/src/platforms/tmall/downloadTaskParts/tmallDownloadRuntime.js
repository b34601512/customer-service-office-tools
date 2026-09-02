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

function buildTmallDownloadEvidenceLabel(reportKeys, stageText) {
  // 这个函数只按真实下载源生成一个凭证标签。
  const reportNameMap = {
    performance: "业绩指标",
    response_time: "平均响应时间",
    three_minute_response_rate: "3分钟响应率",
    customer_satisfaction: "客户满意度"
  };
  const names = [...new Set((Array.isArray(reportKeys) ? reportKeys : [reportKeys])
    .map((reportKey) => reportNameMap[String(reportKey || "").trim()])
    .filter(Boolean))];
  return `天猫${names.join("＋") || "下载"}${stageText}`;
}

module.exports = {
  waitForTmallDownloadStart,
  setTmallDownloadDirectory,
  reportTmallDownloadProgress,
  buildTmallDownloadEvidenceLabel
};
