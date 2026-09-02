// 该文件用于解决报表配置辅助子模块聚合和对外接口注册问题。
const {
  createReportMetricMappings,
  createReportProfile,
  createPerformanceReportProfile
} = require("./storeReportProfileParts/storeReportCreation");
const { validatePersonMappings } = require("./storeReportProfileParts/personMappingValidation");
const { validateStoreReportProfiles } = require("./storeReportProfileParts/storeReportProfileValidation");
const {
  buildReportScopedStoreConfig,
  resolveStoreReportProfile
} = require("./storeReportProfileParts/storeReportRuntime");

module.exports = {
  createReportMetricMappings,
  createReportProfile,
  createPerformanceReportProfile,
  validatePersonMappings,
  validateStoreReportProfiles,
  buildReportScopedStoreConfig,
  resolveStoreReportProfile
};
