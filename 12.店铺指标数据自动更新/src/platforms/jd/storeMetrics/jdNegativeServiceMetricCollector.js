const { createStoreMetricRecord } = require("../../../metrics/storeMetricRecord");
const {
  waitForJdMetricPageText,
  waitForVisibleJdMetricCardText,
  clickVisibleJdMetricTab,
  parseStatisticsDateRange,
  readMetricValue
} = require("./jdMetricText");

function createNegativeServiceRecord(store, tabName, range, definition, collectedAt) {
  return createStoreMetricRecord({
    platform: "京东",
    storeKey: store.key,
    storeName: store.displayName,
    dataDate: range.endDate,
    statisticsStartDate: range.startDate,
    statisticsEndDate: range.endDate,
    metricName: definition.metricName,
    metricValue: definition.unit === "%" ? definition.rawValue / 100 : definition.rawValue,
    unit: definition.unit,
    originalStatisticsWindow: `页面统计区间：${range.startDate}至${range.endDate}`,
    sourcePage: `违规服务分析-${tabName}`,
    sourceUrl: store.sources.negativeService,
    sourceOriginalMetricName: definition.sourceOriginalMetricName,
    collectedAt
  });
}

async function collectTabMetrics(page, store, tabDefinition, collectedAt) {
  await clickVisibleJdMetricTab(page, tabDefinition.tabName);
  if (tabDefinition.childTabName) {
    await clickVisibleJdMetricTab(page, tabDefinition.childTabName);
  }
  const pageText = await waitForVisibleJdMetricCardText(page, tabDefinition.requiredLabels, 60000);
  const range = parseStatisticsDateRange(pageText);
  const records = [];
  const skipped = [];
  for (const metricDefinition of tabDefinition.metrics) {
    const rawValue = await readMetricValue(
      page,
      pageText,
      metricDefinition.sourceOriginalMetricName,
      metricDefinition.unit === "%" ? "%" : metricDefinition.unit === "单" ? "(?:单)?" : ""
    );
    if (rawValue === null) {
      skipped.push(metricDefinition.metricName);
      continue;
    }
    records.push(createNegativeServiceRecord(store, tabDefinition.tabName, range, {
      ...metricDefinition,
      rawValue
    }, collectedAt));
  }
  return { records, skipped };
}

async function collectJdNegativeServiceMetrics(page, store) {
  await page.goto(store.sources.negativeService, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitForJdMetricPageText(page, ["3分钟人工回复率"]);
  const collectedAt = new Date().toISOString();
  const tabDefinitions = [
    {
      tabName: "客服咨询",
      requiredLabels: ["3分钟人工回复率"],
      metrics: [
        { metricName: "3分钟人工回复率", sourceOriginalMetricName: "3分钟人工回复率", unit: "%" },
        { metricName: "咨询差评率", sourceOriginalMetricName: "咨询差评率", unit: "%" }
      ]
    },
    {
      tabName: "物流履约",
      childTabName: "延迟发货",
      requiredLabels: ["延迟发货率"],
      metrics: [
        { metricName: "延迟发货率", sourceOriginalMetricName: "延迟发货率", unit: "%" }
      ]
    },
    {
      tabName: "售后服务",
      requiredLabels: ["售后处理超时率"],
      metrics: [
        { metricName: "售后处理超时率", sourceOriginalMetricName: "售后处理超时率", unit: "%" },
        { metricName: "售后差评率", sourceOriginalMetricName: "售后差评率", unit: "%" }
      ]
    },
    {
      tabName: "交易纠纷",
      requiredLabels: ["工单24小时完结率"],
      metrics: [
        { metricName: "工单24小时完结率", sourceOriginalMetricName: "工单24小时完结率", unit: "%" },
        { metricName: "平台介入率（违规服务分析）", sourceOriginalMetricName: "平台介入率", unit: "%" },
        { metricName: "近7天纠纷商责率", sourceOriginalMetricName: "近7天纠纷商责率", unit: "%" },
        { metricName: "未完结纠纷单申请量", sourceOriginalMetricName: "未完结纠纷单申请量", unit: "单" }
      ]
    }
  ];
  const records = [];
  const skipped = [];
  for (const tabDefinition of tabDefinitions) {
    const tabResult = await collectTabMetrics(page, store, tabDefinition, collectedAt);
    records.push(...tabResult.records);
    skipped.push(...tabResult.skipped);
  }
  return { records, skipped };
}

module.exports = {
  collectJdNegativeServiceMetrics,
  collectTabMetrics
};
