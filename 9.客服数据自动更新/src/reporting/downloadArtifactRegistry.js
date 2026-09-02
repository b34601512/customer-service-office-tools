// 该文件用于解决三平台下载产物统一登记问题，让下载链路只负责拿文件，历史记录格式只在这里维护。
const { appendDownloadRecord } = require("../shared/taskHistoryParts/taskHistoryRecordWriter");

function normalizeText(value) {
  // 这里把外部传入的记录字段统一收口成干净字符串，避免历史记录里混入 undefined。
  return String(value || "").trim();
}

function resolveDownloadReportKey(resolvedConfig, explicitReportKey = "") {
  // 这里统一解析下载产物所属报表，避免各平台重复拼 performance 默认值。
  return (
    normalizeText(explicitReportKey) ||
    normalizeText(resolvedConfig?.reportKey) ||
    normalizeText(resolvedConfig?.activeStore?.activeReportKey) ||
    "performance"
  );
}

function buildDownloadArtifactRecord({ platformKey, resolvedConfig, filePath, exportRange, reportKey = "" }) {
  // 这里只负责把下载产物整理成运行历史需要的标准记录。
  const activeStore = resolvedConfig?.activeStore || {};
  const normalizedPlatformKey = normalizeText(platformKey);
  const normalizedFilePath = normalizeText(filePath);

  if (!normalizedPlatformKey) {
    throw new Error("下载产物登记失败：平台标识不能为空。");
  }
  if (!activeStore.key) {
    throw new Error("下载产物登记失败：当前店铺标识不能为空。");
  }
  if (!normalizedFilePath) {
    throw new Error("下载产物登记失败：文件路径不能为空。");
  }

  return {
    platformKey: normalizedPlatformKey,
    reportKey: resolveDownloadReportKey(resolvedConfig, reportKey),
    sourceReportKeys: Array.isArray(resolvedConfig?.sourceReportKeys)
      ? [...new Set(resolvedConfig.sourceReportKeys.map((item) => normalizeText(item)).filter(Boolean))]
      : [],
    storeKey: normalizeText(activeStore.key),
    storeDisplayName: normalizeText(activeStore.displayName),
    filePath: normalizedFilePath,
    exportStartText: normalizeText(exportRange?.startText),
    exportEndText: normalizeText(exportRange?.endText),
    createdAt: new Date().toISOString()
  };
}

function registerDownloadArtifact(input) {
  // 这里是唯一的下载产物登记入口，三平台下载成功后都必须走这里。
  return appendDownloadRecord(buildDownloadArtifactRecord(input));
}

module.exports = {
  registerDownloadArtifact
};
