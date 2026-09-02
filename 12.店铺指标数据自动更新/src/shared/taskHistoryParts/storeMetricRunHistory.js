const path = require("path");
const {
  TASK_HISTORY_RECORD_LIMIT,
  readTaskHistory,
  writeTaskHistory
} = require("./taskHistoryStore");
const { formatDate } = require("../exportDateRange");

// formatLocalDateKey 与 exportDateRange.formatDate 是同一格式，这里保留导出名作薄委托。
const formatLocalDateKey = formatDate;

function normalizeComparablePath(filePath) {
  const normalizedPath = String(filePath || "").trim();
  return normalizedPath ? path.normalize(normalizedPath).toLowerCase() : "";
}

function resolveStoreSourceSignature(store) {
  if ((store?.platformKey || "jd") === "jd") {
    return [store?.sources?.shopStar, store?.sources?.negativeService, store?.sources?.compliance]
      .map((sourceUrl) => String(sourceUrl || "").trim())
      .join("|");
  }
  const sourceSignature = Object.entries(store?.sources || {})
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([sourceKey, sourceUrl]) => `${sourceKey}=${String(sourceUrl || "").trim()}`)
    .join("|");
  // 拼多多等待真实卡片、修正星级别名并补充同行对比指标，旧记录必须自动失效一次。
  return (store?.platformKey || "") === "pdd"
    ? `${sourceSignature}|metric-schema=pdd-v6`
    : (store?.platformKey || "") === "douyin"
      ? `${sourceSignature}|metric-schema=douyin-v1`
    : sourceSignature;
}

function createStoreMetricRunScope({ store, dateSelection, workbookPath, now = new Date() }) {
  return {
    platformKey: String(store?.platformKey || "jd").trim() || "jd",
    storeKey: String(store?.key || "").trim(),
    runDate: formatLocalDateKey(now),
    dateMode: dateSelection?.mode === "manual" ? "manual" : "automatic",
    snapshotDate: dateSelection?.mode === "manual" ? String(dateSelection?.snapshotDate || "").trim() : "",
    sourceSignature: resolveStoreSourceSignature(store),
    workbookPath: String(workbookPath || "").trim()
  };
}

function normalizeStoreMetricRunRecord(record) {
  return {
    platformKey: String(record?.platformKey || "jd").trim() || "jd",
    storeKey: String(record?.storeKey || "").trim(),
    storeDisplayName: String(record?.storeDisplayName || "").trim(),
    runDate: String(record?.runDate || "").trim(),
    dateMode: record?.dateMode === "manual" ? "manual" : "automatic",
    snapshotDate: String(record?.snapshotDate || "").trim(),
    sourceSignature: String(record?.sourceSignature || "").trim(),
    workbookPath: String(record?.workbookPath || "").trim(),
    metricCount: Math.max(0, Number(record?.metricCount) || 0),
    recordKeys: Array.from(new Set(
      (Array.isArray(record?.recordKeys) ? record.recordKeys : [])
        .map((recordKey) => String(recordKey || "").trim())
        .filter(Boolean)
    )),
    createdAt: String(record?.createdAt || new Date().toISOString())
  };
}

function doesStoreMetricRunMatchScope(record, scope) {
  const normalizedRecord = normalizeStoreMetricRunRecord(record);
  return normalizedRecord.platformKey === scope.platformKey &&
    normalizedRecord.storeKey === scope.storeKey &&
    normalizedRecord.runDate === scope.runDate &&
    normalizedRecord.dateMode === scope.dateMode &&
    normalizedRecord.snapshotDate === scope.snapshotDate &&
    normalizedRecord.sourceSignature === scope.sourceSignature &&
    normalizeComparablePath(normalizedRecord.workbookPath) === normalizeComparablePath(scope.workbookPath);
}

function findSuccessfulStoreMetricRun(input) {
  const scope = createStoreMetricRunScope(input);
  return readTaskHistory().storeMetricRuns
    .map(normalizeStoreMetricRunRecord)
    .find((record) => doesStoreMetricRunMatchScope(record, scope)) || null;
}

function appendSuccessfulStoreMetricRun(input) {
  const history = readTaskHistory();
  const scope = createStoreMetricRunScope(input);
  const nextRecord = normalizeStoreMetricRunRecord({
    ...scope,
    storeDisplayName: input.store?.displayName,
    metricCount: input.metricCount,
    recordKeys: input.recordKeys,
    createdAt: input.createdAt || new Date().toISOString()
  });
  history.storeMetricRuns = [
    nextRecord,
    ...history.storeMetricRuns.filter((record) => !doesStoreMetricRunMatchScope(record, scope))
  ].slice(0, TASK_HISTORY_RECORD_LIMIT);
  writeTaskHistory(history);
  return nextRecord;
}

module.exports = {
  formatLocalDateKey,
  createStoreMetricRunScope,
  normalizeStoreMetricRunRecord,
  doesStoreMetricRunMatchScope,
  findSuccessfulStoreMetricRun,
  appendSuccessfulStoreMetricRun
};
