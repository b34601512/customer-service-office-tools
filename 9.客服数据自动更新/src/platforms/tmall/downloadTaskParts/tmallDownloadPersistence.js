const { log } = require("../../../engine/logger");
const { assertTmallPerformanceDownloadMatchesRange } = require("../tmallPerformanceDownloadGuard");
const { copyDownloadToFinalPath } = require("../tmallDownloadArtifacts");
const { reportTmallDownloadProgress } = require("./tmallDownloadRuntime");

function assertTmallDownloadFileName(finalFileName, exportRange, reportType) {
  // 这个函数只验证正式文件名是否属于当前报表和日期范围。
  if (!reportType.isServiceQualityReport) {
    assertTmallPerformanceDownloadMatchesRange(finalFileName, exportRange);
    return;
  }
  if (!finalFileName.includes(reportType.expectedDownloadTitle)) {
    throw new Error(`天猫质量报表下载文件不匹配：期望包含「${reportType.expectedDownloadTitle}」，实际文件=${finalFileName}。`);
  }
}

function persistTmallDownload(input) {
  // 这个函数只把共享引擎确认的真实文件复制到正式目录。
  const { downloadArtifact, finalPath, resolvedConfig, onProgress } = input;
  if (!downloadArtifact?.fullPath) {
    throw new Error("天猫下载产物无效：运行目录没有返回真实文件。");
  }
  reportTmallDownloadProgress(onProgress, "等待文件落盘", "已捕获运行目录真实文件，正在复制到正式目录");
  const downloadedPath = downloadArtifact.fullPath;
  log("主线:执行", "天猫下载", "文件定位", `最终下载源文件=${downloadedPath}`);
  copyDownloadToFinalPath(downloadedPath, finalPath);
  log(
    "主线:完成",
    "天猫下载",
    "目录检测",
    `店铺=${resolvedConfig.activeStore.displayName}，原始文件=${downloadedPath}，正式文件=${finalPath}`
  );
}

module.exports = {
  assertTmallDownloadFileName,
  persistTmallDownload
};
