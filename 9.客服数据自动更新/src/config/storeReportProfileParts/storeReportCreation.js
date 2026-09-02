// 该文件用于解决报表配置创建和基础规范化问题。
const { createEmptyReportProfile } = require("./storeReportPrimitives");

function createReportMetricMappings(metricMappings = []) {
  // 这里只保留源字段与统一指标名，目标表位置不再属于配置。
  return (Array.isArray(metricMappings) ? metricMappings : []).map((metricMapping, index) => {
    const metricKey = String(metricMapping?.key || `metric_${index}`).trim() || `metric_${index}`;
    return {
      key: metricKey,
      sourceFieldLabel: String(metricMapping?.sourceFieldLabel || "").trim()
    };
  });
}

function createReportProfile(reportKey = "performance", reportConfig = {}) {
  // 这里创建指定报表的配置骨架，让新增统计指标时仍然只走 reportProfiles 一个入口。
  const normalizedReportKey = String(reportKey || "performance").trim() || "performance";
  const profile = createEmptyReportProfile(normalizedReportKey);
  return {
    ...profile,
    key: normalizedReportKey,
    displayName: String(reportConfig?.displayName || profile.displayName).trim() || profile.displayName,
    enabled: reportConfig?.enabled !== false,
    siteUrl: String(reportConfig?.siteUrl || "").trim(),
    downloadMode: String(reportConfig?.downloadMode || "").trim(),
    sourceSheetMode: String(reportConfig?.sourceSheetMode || "").trim() || profile.sourceSheetMode,
    sourceSheetName: String(reportConfig?.sourceSheetName || "").trim(),
    sourceSheetIndex: Number.isInteger(Number(reportConfig?.sourceSheetIndex))
      ? Number(reportConfig.sourceSheetIndex)
      : profile.sourceSheetIndex,
    sourceAliasFieldLabel: String(reportConfig?.sourceAliasFieldLabel || "").trim(),
    metricMappings: createReportMetricMappings(reportConfig?.metricMappings || [])
  };
}

function createPerformanceReportProfile(reportConfig = {}) {
  // 这里保留旧接口名，实际创建逻辑已经统一到通用报表创建器。
  return createReportProfile("performance", reportConfig);
}

module.exports = {
  createReportMetricMappings,
  createReportProfile,
  createPerformanceReportProfile
};
