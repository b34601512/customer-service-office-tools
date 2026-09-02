// 该文件用于统一维护各统计指标的配置边界，避免前后端为同一个指标各写一套名字。
const reportModules = [
  {
    key: "performance",
    title: "业绩统计",
    displayName: "业绩指标",
    enabled: true,
    metrics: [
      { key: "amount", label: "金额指标" },
      { key: "inquiry", label: "询单指标" },
      { key: "order", label: "订单指标" }
    ]
  },
  {
    key: "response_time",
    title: "平均响应时间",
    displayName: "平均响应时间",
    enabled: true,
    metrics: [
      {
        key: "avg_response_time",
        label: "平均响应时间",
        sourceFieldLabel: "平均响应时长"
      }
    ]
  },
  {
    key: "three_minute_response_rate",
    title: "3分钟响应率",
    displayName: "3分钟响应率",
    enabled: true,
    metrics: [
      {
        key: "three_minute_response_rate",
        label: "3分钟响应率",
        sourceFieldLabel: "3分钟响应率"
      }
    ]
  },
  {
    key: "customer_satisfaction",
    title: "客户满意度",
    displayName: "客户满意度",
    enabled: true,
    metrics: [
      {
        key: "satisfied_count",
        label: "满意量",
        sourceFieldLabel: "满意量"
      },
      {
        key: "evaluation_count",
        label: "评价量",
        sourceFieldLabel: "评价量"
      }
    ]
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeReportKey(reportKey) {
  const normalizedKey = String(reportKey || "performance").trim() || "performance";
  return reportModules.some((moduleItem) => moduleItem.key === normalizedKey) ? normalizedKey : "performance";
}

function getReportModule(reportKey = "performance") {
  return clone(reportModules.find((moduleItem) => moduleItem.key === normalizeReportKey(reportKey)) || reportModules[0]);
}

function listReportModules() {
  return clone(reportModules);
}

function listEnabledReportModules() {
  return clone(reportModules.filter((moduleItem) => moduleItem.enabled));
}

function createDefaultMetricMappingsForReport(reportKey = "performance") {
  return getReportModule(reportKey).metrics.map((metric, index) => ({
    key: metric.key || `metric_${index}`,
    sourceFieldLabel: metric.sourceFieldLabel || metric.label || ""
  }));
}

module.exports = {
  reportModules,
  normalizeReportKey,
  getReportModule,
  listReportModules,
  listEnabledReportModules,
  createDefaultMetricMappingsForReport
};
