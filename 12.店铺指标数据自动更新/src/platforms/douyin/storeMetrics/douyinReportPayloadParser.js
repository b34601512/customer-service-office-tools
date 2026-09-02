const { createStoreMetricRecord } = require("../../../metrics/storeMetricRecord");
const {
  formatDate,
  normalizeLooseDateText
} = require("../../../shared/exportDateRange");

const DOUYIN_SOURCE_PAGE_BY_TYPE = {
  experienceScore: "抖音-服务体验"
};

const DOUYIN_METRIC_DEFINITIONS = [
  { metricName: "服务体验得分", unit: "分", sourceMetricNames: ["服务体验得分"] },
  { metricName: "飞鸽平均响应时长得分", unit: "分", sourceMetricNames: ["飞鸽平均响应时长得分"] },
  { metricName: "飞鸽平均响应时长", unit: "秒", sourceMetricNames: ["飞鸽平均响应时长"], skipSuffixes: ["得分"] },
  { metricName: "售后平均审核时长得分", unit: "分", sourceMetricNames: ["售后平均审核时长得分"] },
  { metricName: "售后平均审核时长", unit: "小时", sourceMetricNames: ["售后平均审核时长"], skipSuffixes: ["得分"] },
  { metricName: "飞鸽会话不满意率得分", unit: "分", sourceMetricNames: ["飞鸽会话不满意率得分"] },
  { metricName: "飞鸽会话不满意率", unit: "%", sourceMetricNames: ["飞鸽会话不满意率"], skipSuffixes: ["得分"] },
  { metricName: "平台求助率得分", unit: "分", sourceMetricNames: ["平台求助率得分"] },
  { metricName: "平台求助率", unit: "%", sourceMetricNames: ["平台求助率"], skipSuffixes: ["得分"] },
  { metricName: "差行为扣分", unit: "分", sourceMetricNames: ["差行为扣分"] },
  { metricName: "虚假交易刷体验分扣分", unit: "分", sourceMetricNames: ["虚假交易刷体验分扣分"] },
  { metricName: "影响消费者体验扣分", unit: "分", sourceMetricNames: ["影响消费者体验扣分"] },
  { metricName: "虚假交易刷体验分次数", unit: "次", sourceMetricNames: ["虚假交易刷体验分"], skipSuffixes: ["扣分"] },
  { metricName: "影响消费者体验次数", unit: "次", sourceMetricNames: ["影响消费者体验"], skipSuffixes: ["扣分"] }
];

function normalizeDouyinText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function resolveDouyinDataDate(pageText, fallbackDate = new Date()) {
  const normalizedText = normalizeDouyinText(pageText);
  const labeledDateMatch = normalizedText.match(/(?:统计时间|数据时间|统计日期|截至)\s*[:：]?\s*([^\s，。,；;]+)/);
  const labeledDate = normalizeLooseDateText(labeledDateMatch?.[1]);
  if (labeledDate) return labeledDate;
  return formatDate(fallbackDate);
}

function escapeDouyinRegExpText(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDouyinNumericValue(valueText, expectedUnit) {
  const normalizedValueText = normalizeDouyinText(valueText).replace(/,/g, "");
  const unitPattern = expectedUnit === "%" ? "%" : escapeDouyinRegExpText(expectedUnit);
  const valueMatch = normalizedValueText.match(new RegExp(`(-?(?:\\d+\\.?\\d*|\\.\\d+))\\s*${unitPattern}`));
  if (!valueMatch) return null;
  const rawValue = Number(valueMatch[1]);
  if (!Number.isFinite(rawValue)) return null;
  return {
    metricValue: expectedUnit === "%" ? rawValue / 100 : rawValue,
    unit: expectedUnit,
    rawText: valueMatch[0]
  };
}

function shouldSkipDouyinLabelOccurrence(text, label, occurrenceIndex, skipSuffixes = []) {
  if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0) return true;
  const suffixText = normalizeDouyinText(text.slice(occurrenceIndex + label.length));
  return (Array.isArray(skipSuffixes) ? skipSuffixes : [])
    .some((suffix) => suffix && suffixText.startsWith(String(suffix)));
}

function findNextDouyinLabelIndex(text, occurrenceIndex, allLabels) {
  const nextIndexes = allLabels
    .map((label) => text.indexOf(label, occurrenceIndex + 1))
    .filter((index) => index > occurrenceIndex);
  return nextIndexes.length ? Math.min(...nextIndexes) : text.length;
}

function findDouyinMetricValue(pageText, definition, allLabels = []) {
  const normalizedText = normalizeDouyinText(pageText);
  const labels = Array.from(new Set([
    definition.metricName,
    ...(Array.isArray(definition.sourceMetricNames) ? definition.sourceMetricNames : [])
  ].filter(Boolean))).sort((left, right) => right.length - left.length);
  for (const label of labels) {
    let searchStart = 0;
    while (searchStart < normalizedText.length) {
      const occurrenceIndex = normalizedText.indexOf(label, searchStart);
      if (occurrenceIndex < 0) break;
      searchStart = occurrenceIndex + label.length;
      if (shouldSkipDouyinLabelOccurrence(normalizedText, label, occurrenceIndex, definition.skipSuffixes)) continue;
      const sectionEndIndex = findNextDouyinLabelIndex(normalizedText, occurrenceIndex, allLabels);
      const sectionText = normalizedText.slice(occurrenceIndex + label.length, Math.min(sectionEndIndex, occurrenceIndex + 500));
      const parsedValue = parseDouyinNumericValue(sectionText, definition.unit);
      if (parsedValue) return parsedValue;
    }
  }
  return null;
}

function resolveDouyinStatisticsRange(dataDate) {
  return {
    statisticsStartDate: dataDate,
    statisticsEndDate: dataDate,
    originalStatisticsWindow: `页面统计日：${dataDate}`
  };
}

function buildDouyinMetricRecord({ store, definition, pageText, sourceUrl, collectedAt, fallbackDate }) {
  const allLabels = DOUYIN_METRIC_DEFINITIONS.flatMap((item) => [
    item.metricName,
    ...(Array.isArray(item.sourceMetricNames) ? item.sourceMetricNames : [])
  ]).filter(Boolean);
  const parsedValue = findDouyinMetricValue(pageText, definition, allLabels);
  if (!parsedValue) return null;
  const dataDate = resolveDouyinDataDate(pageText, fallbackDate);
  const statisticsRange = resolveDouyinStatisticsRange(dataDate);
  return createStoreMetricRecord({
    platform: "抖音",
    storeKey: store.key,
    storeName: store.displayName,
    dataDate,
    statisticsStartDate: statisticsRange.statisticsStartDate,
    statisticsEndDate: statisticsRange.statisticsEndDate,
    metricName: definition.metricName,
    metricValue: parsedValue.metricValue,
    unit: definition.unit,
    originalStatisticsWindow: statisticsRange.originalStatisticsWindow,
    sourcePage: DOUYIN_SOURCE_PAGE_BY_TYPE.experienceScore,
    sourceUrl,
    sourceOriginalMetricName: definition.sourceMetricNames?.[0] || definition.metricName,
    collectedAt
  });
}

function buildDouyinStoreMetricRecords({ store, pageText, sourceUrl, collectedAt = new Date().toISOString(), fallbackDate = new Date() }) {
  const skipped = [];
  const records = DOUYIN_METRIC_DEFINITIONS.flatMap((definition) => {
    const record = buildDouyinMetricRecord({ store, definition, pageText, sourceUrl, collectedAt, fallbackDate });
    if (!record) { skipped.push(definition.metricName); return []; }
    return [record];
  });
  if (!records.length) throw new Error("抖音服务体验页面没有读取到有效店铺指标。");
  return { records, skipped };
}

module.exports = {
  DOUYIN_SOURCE_PAGE_BY_TYPE,
  DOUYIN_METRIC_DEFINITIONS,
  normalizeDouyinText,
  resolveDouyinDataDate,
  parseDouyinNumericValue,
  findDouyinMetricValue,
  resolveDouyinStatisticsRange,
  buildDouyinMetricRecord,
  buildDouyinStoreMetricRecords
};
