// 该文件用于解决天猫下载目录、运行目录和最终文件名构造问题。
const path = require("path");
const appConfig = require("../../../config/appConfig");
const { ensureDir } = require("../../../engine/fileSystem");

function buildTimestampText() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
}

function resolveStoreDownloadDir(storeConfig) {
  const downloadDir = String(storeConfig?.downloadDir || "").trim();
  if (!downloadDir) {
    throw new Error("当前店铺缺少下载目录配置。");
  }

  ensureDir(downloadDir);
  return downloadDir;
}

function buildDownloadPath(storeConfig, fileName) {
  return path.join(resolveStoreDownloadDir(storeConfig), `${buildTimestampText()}-${fileName}`);
}

function createRunDownloadDir(storeConfig) {
  // 这里为每次下载分配店铺独立的运行目录，彻底消除不同店铺之间的历史文件干扰。
  const storeKey = String(storeConfig?.key || "").trim();
  if (!storeKey) {
    throw new Error("当前店铺缺少标识，无法创建独立下载缓存目录。");
  }

  const runDownloadDir = path.join(appConfig.getStoreDownloadRunDir("tmall", storeKey), buildTimestampText());
  ensureDir(runDownloadDir);
  return runDownloadDir;
}

function sanitizeFileNameSegment(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeGuidFileName(fileName) {
  const extension = path.extname(fileName || "");
  const baseName = path.basename(fileName || "", extension);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(baseName);
}

function buildPreferredDownloadFileName(storeConfig, exportRange, originalFileName = "") {
  const safeOriginalFileName = path.basename(String(originalFileName || "").trim());
  const originalExtension = path.extname(safeOriginalFileName);

  if (safeOriginalFileName && originalExtension && !looksLikeGuidFileName(safeOriginalFileName)) {
    return safeOriginalFileName;
  }

  const safeStoreName = sanitizeFileNameSegment(storeConfig?.displayName || "天猫店铺");
  const startText = String(exportRange?.startText || "").replaceAll("-", "");
  const endText = String(exportRange?.endText || "").replaceAll("-", "");
  const extension = originalExtension || ".xlsx";
  return `${safeStoreName}-客服绩效_${startText}_${endText}${extension}`;
}

module.exports = {
  resolveStoreDownloadDir,
  buildDownloadPath,
  createRunDownloadDir,
  buildPreferredDownloadFileName,
  looksLikeGuidFileName
};
