const path = require("path");
const appConfig = require("../../config/appConfig");
const { remapRuntimeMigrationPath } = require("../../config/runtimePathParts/runtimeMigrationPaths");

function normalizeHistoryDateText(value) {
  // 这个函数只把历史日期统一成 YYYY-MM-DD，确保新旧记录使用同一匹配口径。
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return "";
}

function inferHistoryExportRange(record) {
  // 这个函数只从显式字段或旧文件名中还原导出日期，保持已有历史可继续使用。
  const explicitStartText = normalizeHistoryDateText(record?.exportStartText);
  const explicitEndText = normalizeHistoryDateText(record?.exportEndText);
  if (explicitStartText && explicitEndText) {
    return { exportStartText: explicitStartText, exportEndText: explicitEndText };
  }

  const pathCandidate = String(record?.sourceFilePath || record?.filePath || "").trim();
  const dateTokenList = (path.basename(pathCandidate).match(/\d{4}-\d{2}-\d{2}|\d{8}/g) || []);
  if (dateTokenList.length < 2) {
    return { exportStartText: "", exportEndText: "" };
  }

  const [startToken, endToken] = dateTokenList.slice(-2);
  return {
    exportStartText: normalizeHistoryDateText(startToken),
    exportEndText: normalizeHistoryDateText(endToken)
  };
}

function normalizeSourceReportKeys(sourceReportKeys) {
  // 这个函数只统一真实下载来源键，凭证与源文件必须使用同一份来源信息。
  return Array.isArray(sourceReportKeys)
    ? [...new Set(sourceReportKeys.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];
}

function buildTmallEvidenceLabel(label, sourceReportKeys) {
  // 这个函数只修正旧天猫凭证的错误名称，让凭证名称对应真实下载来源。
  const originalLabel = String(label || "下载凭证").trim() || "下载凭证";
  if (!originalLabel.startsWith("天猫业绩指标")) {
    return originalLabel;
  }
  const reportNameByKey = {
    performance: "业绩指标",
    response_time: "平均响应时间",
    three_minute_response_rate: "3分钟响应率",
    customer_satisfaction: "客户满意度"
  };
  const reportNames = normalizeSourceReportKeys(sourceReportKeys)
    .map((reportKey) => reportNameByKey[reportKey])
    .filter(Boolean);
  return reportNames.length
    ? `天猫${reportNames.join("＋")}${originalLabel.slice("天猫业绩指标".length)}`
    : originalLabel;
}

function normalizeEvidenceFiles(record, sourceReportKeys) {
  // 这个函数只规范化凭证路径、名称和来源键，避免凭证与源表脱离。
  if (!Array.isArray(record?.evidenceFiles)) {
    return [];
  }
  return record.evidenceFiles.map((item) => {
    const evidenceSourceReportKeys = normalizeSourceReportKeys(item?.sourceReportKeys);
    const resolvedSourceReportKeys = evidenceSourceReportKeys.length ? evidenceSourceReportKeys : sourceReportKeys;
    return {
      label: record?.platformKey === "tmall"
        ? buildTmallEvidenceLabel(item?.label, resolvedSourceReportKeys)
        : String(item?.label || "下载凭证").trim() || "下载凭证",
      filePath: remapRuntimeMigrationPath(appConfig.projectRoot, String(item?.filePath || "").trim()),
      sourceReportKeys: resolvedSourceReportKeys
    };
  }).filter((item) => item.filePath);
}

function normalizeTaskHistoryRecord(record) {
  // 这个函数只把一条下载或导入历史整理成唯一标准结构。
  const inferredExportRange = inferHistoryExportRange(record);
  const sourceReportKeys = normalizeSourceReportKeys(record?.sourceReportKeys);
  return {
    platformKey: String(record?.platformKey || "").trim(),
    storeKey: String(record?.storeKey || "").trim(),
    reportKey: String(record?.reportKey || "performance").trim() || "performance",
    sourceReportKeys,
    evidenceFiles: normalizeEvidenceFiles(record, sourceReportKeys),
    storeDisplayName: String(record?.storeDisplayName || "").trim(),
    filePath: remapRuntimeMigrationPath(appConfig.projectRoot, String(record?.filePath || "").trim()),
    sourceFilePath: remapRuntimeMigrationPath(appConfig.projectRoot, String(record?.sourceFilePath || "").trim()),
    workbookPath: remapRuntimeMigrationPath(appConfig.projectRoot, String(record?.workbookPath || "").trim()),
    exportStartText: inferredExportRange.exportStartText,
    exportEndText: inferredExportRange.exportEndText,
    createdAt: String(record?.createdAt || new Date().toISOString())
  };
}

module.exports = {
  normalizeHistoryDateText,
  normalizeTaskHistoryRecord
};
