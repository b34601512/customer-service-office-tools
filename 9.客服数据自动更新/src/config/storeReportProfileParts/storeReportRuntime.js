// 该文件用于解决报表作用域运行态店铺配置解析问题。
const {
  clone
} = require("./storeReportPrimitives");
const {
  createReportMetricMappings
} = require("./storeReportCreation");

function buildReportScopedStoreConfig(storeConfig = {}, reportProfile = {}) {
  // 这里把店铺通用配置和具体报表配置合成运行态店铺，执行模块只消费这一层扁平结果。
  if (!reportProfile || typeof reportProfile !== "object" || Array.isArray(reportProfile)) {
    throw new Error(`当前店铺缺少报表配置：${storeConfig?.displayName || storeConfig?.key || "未知店铺"}`);
  }
  const normalizedReportProfile = clone(reportProfile);
  const metricMappings = createReportMetricMappings(normalizedReportProfile.metricMappings || []);

  return {
    ...storeConfig,
    enabled: normalizedReportProfile.enabled !== false,
    siteUrl: String(normalizedReportProfile.siteUrl || "").trim(),
    downloadMode: String(normalizedReportProfile.downloadMode || "").trim(),
    sourceSheetMode: String(normalizedReportProfile.sourceSheetMode || "").trim() || "single_sheet",
    sourceSheetName: String(normalizedReportProfile.sourceSheetName || "").trim(),
    sourceSheetIndex: Number.isInteger(Number(normalizedReportProfile.sourceSheetIndex))
      ? Number(normalizedReportProfile.sourceSheetIndex)
      : 0,
    sourceAliasFieldLabel: String(normalizedReportProfile.sourceAliasFieldLabel || "").trim(),
    metricMappings,
    activeReportKey: String(normalizedReportProfile.key || "performance").trim() || "performance",
    activeReportDisplayName: String(normalizedReportProfile.displayName || "").trim(),
    reportProfile: normalizedReportProfile
  };
}

function resolveStoreReportProfile(storeConfig, reportKey = "performance") {
  // 这里统一解析某家店在某张报表下的生效配置，只接受 reportProfiles 结构。
  const normalizedKey = String(reportKey || "performance").trim() || "performance";
  const reportProfiles =
    storeConfig?.reportProfiles && typeof storeConfig.reportProfiles === "object"
      ? storeConfig.reportProfiles
      : null;

  if (reportProfiles?.[normalizedKey]) {
    return clone(reportProfiles[normalizedKey]);
  }

  throw new Error(`当前店铺缺少报表配置：${normalizedKey}`);
}

module.exports = {
  buildReportScopedStoreConfig,
  resolveStoreReportProfile
};
