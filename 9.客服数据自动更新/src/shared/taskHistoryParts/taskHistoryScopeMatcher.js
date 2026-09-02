const { normalizeHistoryDateText } = require("./taskHistoryRecordNormalizer");

function selectLatestTaskHistoryRecord(records, matcher) {
  // 这个函数只按历史原有的最新优先顺序选择第一条匹配记录。
  return (records || []).find((item) => matcher(item)) || null;
}

function resolveExpectedExportRange(exportRange) {
  // 这个函数只把本轮导出日期转换成历史匹配口径。
  return {
    exportStartText: normalizeHistoryDateText(exportRange?.startText || exportRange?.start?.customDate),
    exportEndText: normalizeHistoryDateText(exportRange?.endText || exportRange?.end?.customDate)
  };
}

function normalizeHistoryTimeMs(value) {
  // 这个函数只把历史时间转换成可比较毫秒值，无效时间明确返回零。
  const timeMs = Date.parse(String(value || "").trim());
  return Number.isFinite(timeMs) ? timeMs : 0;
}

function isRecordCreatedAfter(record, createdAfter) {
  // 这个函数只判断记录是否属于本轮任务开始之后。
  const createdAfterMs = normalizeHistoryTimeMs(createdAfter);
  if (!createdAfterMs) {
    return true;
  }
  const recordCreatedAtMs = normalizeHistoryTimeMs(record?.createdAt);
  return Boolean(recordCreatedAtMs) && recordCreatedAtMs >= createdAfterMs;
}

function doesRecordMatchReportKey(record, expectedReportKey) {
  // 这个函数只隔离不同报表的历史记录。
  const normalizedExpectedKey = String(expectedReportKey || "").trim();
  if (!normalizedExpectedKey) {
    return true;
  }
  return (String(record?.reportKey || "performance").trim() || "performance") === normalizedExpectedKey;
}

function doesTaskHistoryRecordMatchScope(record, platformKey, storeKey, exportRange, options = {}) {
  // 这个函数只统一校验平台、店铺、报表、轮次和日期区间五个成功作用域。
  if (record.platformKey !== platformKey || record.storeKey !== storeKey) {
    return false;
  }
  if (!doesRecordMatchReportKey(record, options.reportKey) || !isRecordCreatedAfter(record, options.createdAfter)) {
    return false;
  }
  const expectedExportRange = resolveExpectedExportRange(exportRange);
  if (!expectedExportRange.exportStartText && !expectedExportRange.exportEndText) {
    return true;
  }
  return record.exportStartText === expectedExportRange.exportStartText &&
    record.exportEndText === expectedExportRange.exportEndText;
}

module.exports = {
  doesTaskHistoryRecordMatchScope,
  selectLatestTaskHistoryRecord
};
