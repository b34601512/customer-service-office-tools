const path = require("path");

function isMissingMetricValue(value) {
  // 这个函数只判断一个指标是否确实没有源数据。
  return value === null || value === undefined || String(value).trim() === "";
}

function readMetric(metrics, key) {
  // 这个函数只取得一个已读取指标的数值或空值。
  const value = metrics?.[key];
  if (isMissingMetricValue(value)) {
    return null;
  }
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

const ADDITIVE_METRIC_KEYS = new Set([
  "amount",
  "inquiry",
  "order",
  "response_weight",
  "three_minute_unreplied_count",
  "satisfied_count",
  "evaluation_count"
]);

function addSourceMetrics(personMetrics, sourceMetrics, personName) {
  // 可加总指标累加；不可加总指标遇到不同值直接报错，禁止静默覆盖。
  Object.entries(sourceMetrics || {}).forEach(([metricKey, metricValue]) => {
    if (isMissingMetricValue(metricValue)) return;
    const numericValue = Number(metricValue);
    if (!Number.isFinite(numericValue)) return;
    if (isMissingMetricValue(personMetrics[metricKey])) {
      personMetrics[metricKey] = numericValue;
      return;
    }
    if (ADDITIVE_METRIC_KEYS.has(metricKey)) {
      personMetrics[metricKey] += numericValue;
      return;
    }
    if (Number(personMetrics[metricKey]) !== numericValue) {
      throw new Error(`客服“${personName}”的指标“${metricKey}”出现多个不同源值，已停止静默覆盖。`);
    }
  });
}

function buildResponseTotals(metrics) {
  // 这个函数只从响应均值、权重和及时率生成可汇总的原始数值。
  const responseWeight = readMetric(metrics, "response_weight");
  const averageResponseSeconds = readMetric(metrics, "avg_response_time");
  const threeMinuteRate = readMetric(metrics, "three_minute_response_rate");
  const threeMinuteUnrepliedCount = readMetric(metrics, "three_minute_unreplied_count");
  const thirtySecondResponseRate = readMetric(metrics, "thirty_second_response_rate");
  const hasResponseWeight = responseWeight !== null;
  return {
    responseWeight,
    responseTotalSeconds: !hasResponseWeight || averageResponseSeconds === null
      ? null
      : averageResponseSeconds * responseWeight,
    threeMinuteWithinCount: !hasResponseWeight
      ? null
      : threeMinuteUnrepliedCount !== null
      ? Math.max(0, responseWeight - threeMinuteUnrepliedCount)
      : threeMinuteRate === null ? null : threeMinuteRate * responseWeight,
    thirtySecondWithinCount: !hasResponseWeight || thirtySecondResponseRate === null
      ? null
      : thirtySecondResponseRate * responseWeight
  };
}

function buildSummaryDataRows({ task, dateRange, sourceFiles, reportReadResults }) {
  // 这个函数只把一家店全部已读取源表合成为可追加的一行一客服数据。
  const metricsByPerson = new Map();
  reportReadResults.forEach((reportResult) => {
    (reportResult.rows || []).forEach((sourceRow) => {
      const personName = String(sourceRow.personName || "").trim();
      if (!personName) return;
      const personMetrics = metricsByPerson.get(personName) || {};
      addSourceMetrics(personMetrics, sourceRow.metrics, personName);
      metricsByPerson.set(personName, personMetrics);
    });
  });
  if (!metricsByPerson.size) throw new Error("本店没有可写入的数据明细。");
  const sourceFileNames = [...new Set((sourceFiles || []).map((item) => path.basename(item.filePath)).filter(Boolean))].join(" | ");
  const importedAt = new Date().toISOString();
  return [...metricsByPerson.entries()].map(([personName, metrics]) => {
    const responseTotals = buildResponseTotals(metrics);
    return {
      periodStart: String(dateRange.startText || ""),
      periodEnd: String(dateRange.endText || ""),
      periodGranularity: "统计期间",
      platform: String(task.platformLabel || task.platformKey || ""),
      storeKey: String(task.storeKey || ""),
      storeName: String(task.storeDisplayName || ""),
      personName,
      salesAmount: readMetric(metrics, "amount"),
      inquiryCount: readMetric(metrics, "inquiry"),
      orderCount: readMetric(metrics, "order"),
      responseWeight: responseTotals.responseWeight,
      responseTotalSeconds: responseTotals.responseTotalSeconds,
      threeMinuteWithinCount: responseTotals.threeMinuteWithinCount,
      thirtySecondWithinCount: responseTotals.thirtySecondWithinCount,
      satisfiedCount: readMetric(metrics, "satisfied_count"),
      evaluationCount: readMetric(metrics, "evaluation_count"),
      sourceFiles: sourceFileNames,
      importedAt
    };
  });
}

module.exports = {
  buildSummaryDataRows,
  buildResponseTotals
};
