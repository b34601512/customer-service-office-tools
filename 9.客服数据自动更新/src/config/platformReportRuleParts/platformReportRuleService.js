// 该文件只负责读取并应用统一的平台报表规则。

const { REPORT_RULE_BY_PLATFORM_REPORT_AND_DOWNLOAD_MODE, DEFAULT_SOURCE_BY_PLATFORM_REPORT } = require("./platformReportRuleRegistry");

function cloneMetricMappings(metricMappings) {
  // 该函数只复制指标映射，避免调用方修改规则真源。
  return metricMappings.map((metricMapping) => ({ ...metricMapping }));
}

function getPlatformReportRule(platformKey, reportKey, downloadMode) {
  // 该函数只读取平台、报表和下载方式对应的源表规则副本。
  const normalizedPlatformKey = String(platformKey || "").trim().toLowerCase();
  const normalizedReportKey = String(reportKey || "").trim() || "performance";
  const normalizedDownloadMode = String(downloadMode || "").trim().toLowerCase();
  const rule = REPORT_RULE_BY_PLATFORM_REPORT_AND_DOWNLOAD_MODE[normalizedPlatformKey]?.[normalizedReportKey]?.[normalizedDownloadMode] || null;
  if (!rule) return null;
  return { ...rule, metricMappings: cloneMetricMappings(rule.metricMappings) };
}

function getPlatformReportDefaultSource(platformKey, reportKey) {
  // 该函数只返回平台报表默认来源的独立副本。
  const normalizedPlatformKey = String(platformKey || "").trim().toLowerCase();
  const normalizedReportKey = String(reportKey || "").trim() || "performance";
  const source = DEFAULT_SOURCE_BY_PLATFORM_REPORT[normalizedPlatformKey]?.[normalizedReportKey] || null;
  return source ? { ...source } : null;
}

function applyPlatformReportDefaultSource(platformKey, reportKey, reportProfile) {
  // 该函数只固定官方下载方式并在链接为空时补默认地址。
  const source = getPlatformReportDefaultSource(platformKey, reportKey);
  if (!source) return reportProfile;
  return {
    ...reportProfile,
    siteUrl: String(reportProfile?.siteUrl || "").trim() || source.siteUrl,
    downloadMode: source.downloadMode
  };
}

function applyPlatformReportRule(platformKey, reportKey, reportProfile) {
  // 该函数只把真实源表结构规则应用到一张报表配置。
  const rule = getPlatformReportRule(platformKey, reportKey, reportProfile?.downloadMode);
  if (!rule) return reportProfile;
  return {
    ...reportProfile,
    sourceSheetMode: rule.sourceSheetMode,
    sourceSheetName: rule.sourceSheetName,
    sourceSheetIndex: rule.sourceSheetIndex,
    sourceAliasFieldLabel: rule.sourceAliasFieldLabel,
    metricMappings: rule.metricMappings
  };
}

function applyPlatformReportDefaultsToStore(platformKey, storeConfig) {
  // 该函数只把平台默认来源和源表规则应用到一家店铺的全部报表。
  const reportProfiles = Object.fromEntries(Object.entries(storeConfig?.reportProfiles || {}).map(([reportKey, reportProfile]) => {
    const sourceProfile = applyPlatformReportDefaultSource(platformKey, reportKey, reportProfile);
    return [reportKey, applyPlatformReportRule(platformKey, reportKey, sourceProfile)];
  }));
  return { ...storeConfig, reportProfiles };
}

module.exports = { getPlatformReportRule, getPlatformReportDefaultSource, applyPlatformReportDefaultSource, applyPlatformReportRule, applyPlatformReportDefaultsToStore };
