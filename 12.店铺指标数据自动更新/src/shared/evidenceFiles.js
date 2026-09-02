// 该文件用于统一店铺指标凭证的目录、名称、路径和失败文字兜底。
const fs = require("fs");
const path = require("path");
const appConfig = require("../config/appConfig");
const { PLATFORM_SCOPE_DEFINITIONS } = require("./storeCollectionScope");

// 平台中文名以 storeCollectionScope 的平台清单为唯一真源；批量任务凭证目录另挂本地特例。
const EVIDENCE_PLATFORM_DISPLAY_NAME_BY_KEY = {
  ...Object.fromEntries(
    PLATFORM_SCOPE_DEFINITIONS.map(({ platformKey, platformName }) => [platformKey, platformName])
  ),
  batch: "批量任务"
};

function normalizeEvidenceScopePart(value) {
  return String(value || "unknown").replace(/[\\/:*?"<>|\s]+/g, "-");
}

function formatEvidenceTimestamp(date = new Date()) {
  const dateParts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
    String(date.getMilliseconds()).padStart(3, "0")
  ];
  return `${dateParts[0]}-${dateParts[1]}-${dateParts[2]}-${dateParts[3]}-${dateParts[4]}-${dateParts[5]}-${dateParts[6]}`;
}

function resolveEvidencePlatformDisplayName(platformKey) {
  const normalizedPlatformKey = String(platformKey || "").trim().toLowerCase();
  return EVIDENCE_PLATFORM_DISPLAY_NAME_BY_KEY[normalizedPlatformKey] ||
    normalizedPlatformKey || "未知平台";
}

function buildStoreMetricEvidenceDirectoryName({
  timestampText = formatEvidenceTimestamp(),
  platformKey = "",
  storeKey = "",
  storeDisplayName = "",
  taskDisplayName = ""
} = {}) {
  const evidenceScopeParts = taskDisplayName
    ? [taskDisplayName]
    : [resolveEvidencePlatformDisplayName(platformKey), storeDisplayName || "未命名店铺", storeKey || "unknown"];
  const scopeText = evidenceScopeParts.map(normalizeEvidenceScopePart).filter(Boolean).join("-");
  return `${timestampText}-${scopeText || "task"}`;
}

function buildEvidenceFileName({ evidenceLabel, resultLabel = "", fileExtension = "txt" } = {}) {
  const normalizedFileNameParts = [evidenceLabel, resultLabel]
    .map((fileNamePart) => String(fileNamePart || "").trim())
    .filter(Boolean)
    .map(normalizeEvidenceScopePart);
  const normalizedFileExtension = String(fileExtension || "txt").replace(/^\./, "").trim() || "txt";
  return `${normalizedFileNameParts.join("-") || "凭证"}.${normalizedFileExtension}`;
}

function buildEvidenceFilePath({ evidenceDirectory, evidenceLabel, resultLabel = "", fileExtension = "txt" } = {}) {
  return path.join(
    evidenceDirectory,
    buildEvidenceFileName({ evidenceLabel, resultLabel, fileExtension })
  );
}

function createStoreMetricEvidenceDirectory(options = {}) {
  const evidenceDirectoryName = buildStoreMetricEvidenceDirectoryName(options);
  const evidenceDirectory = path.join(
    appConfig.projectRoot,
    "runtime",
    "evidence",
    "store-metrics",
    evidenceDirectoryName
  );
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  return evidenceDirectory;
}

function inferEvidenceLabel(filePath, index) {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  if (extension === ".txt") return "失败原因";
  return `页面凭证${index + 1}`;
}

function normalizeEvidenceFiles(evidenceFiles) {
  const normalizedFiles = [];
  const knownPaths = new Set();
  for (const [index, evidenceItem] of (Array.isArray(evidenceFiles) ? evidenceFiles : []).entries()) {
    const rawFilePath = String(
      typeof evidenceItem === "string" ? evidenceItem : evidenceItem?.filePath || ""
    ).trim();
    if (!rawFilePath) continue;
    const filePath = path.resolve(rawFilePath);
    if (knownPaths.has(filePath.toLowerCase())) continue;
    knownPaths.add(filePath.toLowerCase());
    normalizedFiles.push({
      label: String(
        typeof evidenceItem === "string" ? "" : evidenceItem?.label || ""
      ).trim() || inferEvidenceLabel(filePath, normalizedFiles.length),
      filePath
    });
  }
  return normalizedFiles;
}

function mergeEvidenceFiles(...evidenceFileLists) {
  return normalizeEvidenceFiles(evidenceFileLists.flat());
}

function listExistingEvidenceFiles(evidenceFiles) {
  return normalizeEvidenceFiles(evidenceFiles).filter((evidenceFile) =>
    fs.existsSync(evidenceFile.filePath) && fs.statSync(evidenceFile.filePath).isFile());
}

function writeFailureReasonEvidence({ evidenceDirectory, scopeLabel, error }) {
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  const filePath = buildEvidenceFilePath({
    evidenceDirectory,
    evidenceLabel: "失败原因",
    resultLabel: formatEvidenceTimestamp(),
    fileExtension: "txt"
  });
  const errorMessage = String(error?.message || error || "未读到错误原因");
  fs.writeFileSync(filePath, [
    `范围：${scopeLabel || "店铺指标批量汇总"}`,
    `时间：${new Date().toISOString()}`,
    `原因：${errorMessage}`
  ].join("\n"), "utf8");
  return { label: "失败原因", filePath };
}

function ensureStoreMetricFailureEvidence({ store, error }) {
  const evidenceDirectory = String(error?.evidenceDirectory || "").trim() ||
    createStoreMetricEvidenceDirectory({
      platformKey: store?.platformKey || "jd",
      storeKey: store?.key || "unknown",
      storeDisplayName: store?.displayName || "当前店铺"
    });
  const failureReasonEvidence = writeFailureReasonEvidence({
    evidenceDirectory,
    scopeLabel: store?.displayName || store?.key || "当前店铺",
    error
  });
  return listExistingEvidenceFiles(mergeEvidenceFiles(error?.evidenceFiles, failureReasonEvidence));
}

function ensureBatchFailureEvidence(error) {
  const evidenceDirectory = createStoreMetricEvidenceDirectory({ taskDisplayName: "批量汇总" });
  const failureReasonEvidence = writeFailureReasonEvidence({
    evidenceDirectory,
    scopeLabel: "店铺指标批量汇总",
    error
  });
  return [failureReasonEvidence];
}

module.exports = {
  formatEvidenceTimestamp,
  resolveEvidencePlatformDisplayName,
  buildStoreMetricEvidenceDirectoryName,
  buildEvidenceFileName,
  buildEvidenceFilePath,
  createStoreMetricEvidenceDirectory,
  normalizeEvidenceFiles,
  mergeEvidenceFiles,
  listExistingEvidenceFiles,
  writeFailureReasonEvidence,
  ensureStoreMetricFailureEvidence,
  ensureBatchFailureEvidence
};
