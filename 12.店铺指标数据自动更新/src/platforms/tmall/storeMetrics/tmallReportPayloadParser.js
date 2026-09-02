const { createStoreMetricRecord } = require("../../../metrics/storeMetricRecord");
const { shiftDateText } = require("../../../shared/exportDateRange");

const TMALL_REPORT_SOURCE_PAGE = "千牛-真实体验分";

function normalizeCompactDate(dateText) {
  const compactDate = String(dateText || "").replace(/-/g, "").trim();
  if (!/^\d{8}$/.test(compactDate)) return "";
  return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
}

function parseIntervalDateRange(intervalText, fallbackRange) {
  const dateMatches = String(intervalText || "").match(/\d{4}-\d{2}-\d{2}/g) || [];
  if (dateMatches.length >= 2) {
    return { startDate: dateMatches.at(-2), endDate: dateMatches.at(-1) };
  }
  return fallbackRange;
}

function parseMetricValue(metric) {
  const rawValue = Number(metric?.value);
  if (Number.isFinite(rawValue)) return rawValue;
  const showValueText = String(metric?.showValue || "").replace(/,/g, "").trim();
  const parsedValue = Number(showValueText.replace(/%|小时|分|单|笔/g, ""));
  if (!Number.isFinite(parsedValue)) return null;
  return showValueText.includes("%") ? parsedValue / 100 : parsedValue;
}

function listTmallScoreDefinitions(indicatorData) {
  const supportedCodes = new Set(["nps", "newGoods", "newLogistics", "newServices"]);
  return (indicatorData?.list || []).flatMap((indicator) => {
    const score = Number(indicator?.score);
    if (!supportedCodes.has(indicator?.code) || !Number.isFinite(score)) return [];
    return [{
      metricName: String(indicator.name || "").trim(),
      metricValue: score,
      unit: "分",
      sourceOriginalMetricName: String(indicator.name || "").trim()
    }];
  });
}

function buildOriginalMetricName(metric) {
  const metricName = String(metric?.name || "").trim();
  const tagText = String(metric?.tagDTO?.text || "").trim();
  return tagText ? `${metricName}（${tagText}）` : metricName;
}

function listTmallAssessmentDefinitions(summaryData, fallbackRange) {
  const definitions = [];
  const skipped = [];
  for (const mainIndex of summaryData?.mainIndexInfoList || []) {
    for (const subIndex of mainIndex?.subIndexInfoList || []) {
      const metricValue = parseMetricValue(subIndex);
      const metricName = String(subIndex?.name || "").trim();
      if (!Number.isFinite(metricValue) || !metricName) {
        if (metricName) skipped.push(metricName);
        continue;
      }
      const metricRange = parseIntervalDateRange(subIndex?.indexDesc?.interval, fallbackRange);
      const showValueText = String(subIndex?.showValue || "");
      const valueDefinition = {
        metricName: String(subIndex.name).trim(),
        metricValue,
        unit: showValueText.includes("%") ? "%" : String(subIndex?.unit || "").trim(),
        sourceOriginalMetricName: buildOriginalMetricName(subIndex),
        statisticsStartDate: metricRange.startDate,
        statisticsEndDate: metricRange.endDate,
        originalStatisticsWindow: String(subIndex?.indexDesc?.interval || "页面近30天口径").trim()
      };
      definitions.push(valueDefinition);
      const scoreValue = Number(subIndex?.score);
      if (Number.isFinite(scoreValue)) {
        definitions.push({
          ...valueDefinition,
          metricName: `${valueDefinition.metricName}-考核得分`,
          metricValue: scoreValue,
          unit: "分",
          sourceOriginalMetricName: `${valueDefinition.sourceOriginalMetricName}-考核得分`
        });
      }
    }
  }
  return { definitions, skipped };
}
function buildTmallStoreMetricRecords({
  store,
  dataDate,
  statisticsStartDate,
  statisticsEndDate,
  indicatorData,
  summaryData,
  collectedAt = new Date().toISOString()
}) {
  const normalizedDataDate = normalizeCompactDate(dataDate);
  if (!normalizedDataDate) throw new Error("天猫真实体验分页没有返回有效数据日期。");
  const fallbackRange = {
    startDate: normalizeCompactDate(statisticsStartDate) || shiftDateText(normalizedDataDate, -29),
    endDate: normalizeCompactDate(statisticsEndDate) || normalizedDataDate
  };
  const assessmentResult = listTmallAssessmentDefinitions(summaryData, fallbackRange);
  const metricDefinitions = [
    ...listTmallScoreDefinitions(indicatorData).map((definition) => ({
      ...definition,
      statisticsStartDate: fallbackRange.startDate,
      statisticsEndDate: fallbackRange.endDate,
      originalStatisticsWindow: `页面近30天：${fallbackRange.startDate}至${fallbackRange.endDate}`
    })),
    ...assessmentResult.definitions
  ];
  const skipped = [...assessmentResult.skipped];
  const uniqueMetricNames = new Set();
  const records = [];
  for (const definition of metricDefinitions) {
    if (uniqueMetricNames.has(definition.metricName)) continue;
    uniqueMetricNames.add(definition.metricName);
    records.push(createStoreMetricRecord({
      platform: "天猫",
      storeKey: store.key,
      storeName: store.displayName,
      dataDate: normalizedDataDate,
      statisticsStartDate: definition.statisticsStartDate,
      statisticsEndDate: definition.statisticsEndDate,
      metricName: definition.metricName,
      metricValue: definition.metricValue,
      unit: definition.unit,
      originalStatisticsWindow: definition.originalStatisticsWindow,
      sourcePage: TMALL_REPORT_SOURCE_PAGE,
      sourceUrl: store.sources.serverReport,
      sourceOriginalMetricName: definition.sourceOriginalMetricName,
      collectedAt
    }));
  }
  return { records, skipped };
}

module.exports = {
  TMALL_REPORT_SOURCE_PAGE,
  normalizeCompactDate,
  parseIntervalDateRange,
  parseMetricValue,
  listTmallScoreDefinitions,
  listTmallAssessmentDefinitions,
  buildTmallStoreMetricRecords
};
