const crypto = require("crypto");

function normalizeText(value) {
  return String(value ?? "").trim();
}

function createMetricRecordKey(record) {
  const keyParts = [
    record.platform,
    record.storeKey,
    record.dataDate,
    record.statisticsStartDate,
    record.statisticsEndDate,
    record.sourcePage,
    record.sourceOriginalMetricName,
    record.metricName
  ].map(normalizeText);
  return crypto.createHash("sha256").update(keyParts.join("|"), "utf8").digest("hex").slice(0, 24);
}

function createStoreMetricRecord(input) {
  const numericValue = Number(input.metricValue);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`指标「${input.metricName || input.sourceOriginalMetricName || "未命名"}」不是有效数值。`);
  }
  const platform = normalizeText(input.platform || "京东");
  const originalMetricName = normalizeText(input.metricName);
  const record = {
    dataMonth: normalizeText(input.dataMonth || normalizeText(input.dataDate).slice(0, 7)),
    dataDate: normalizeText(input.dataDate),
    statisticsStartDate: normalizeText(input.statisticsStartDate),
    statisticsEndDate: normalizeText(input.statisticsEndDate),
    platform,
    storeKey: normalizeText(input.storeKey || "jd1"),
    storeName: normalizeText(input.storeName || "京东1店"),
    metricName: `${platform}-${originalMetricName}`,
    metricValue: numericValue,
    unit: normalizeText(input.unit),
    originalStatisticsWindow: normalizeText(input.originalStatisticsWindow),
    sourcePage: normalizeText(input.sourcePage),
    sourceUrl: normalizeText(input.sourceUrl),
    sourceOriginalMetricName: normalizeText(input.sourceOriginalMetricName || originalMetricName),
    collectedAt: normalizeText(input.collectedAt || new Date().toISOString())
  };
  if (!record.dataDate || !platform || !originalMetricName || !record.sourcePage) {
    throw new Error("店铺指标记录缺少数据日期、指标名称或来源页面。");
  }
  return { ...record, recordKey: createMetricRecordKey(record) };
}

module.exports = {
  createMetricRecordKey,
  createStoreMetricRecord
};
