const {
  createExportDateRangeConfig,
  resolveExportDateRangeToManualConfig
} = require("../shared/exportDateRange");
const { createMetricMapping } = require("./projectConfigDefaults");
const { createReportProfile, createPerformanceReportProfile } = require("./storeReportProfileHelpers");
const { createDefaultMetricMappingsForReport } = require("./reportModuleDefinitions");

function createFallbackStoreTemplate() {
  // 这里集中维护“新增店铺/额外店铺”的最小模板，保证持久化结构始终是通用字段 + reportProfiles。
  const performanceProfile = createPerformanceReportProfile({
    downloadMode: "single_file",
    sourceSheetMode: "single_sheet",
    sourceSheetName: "",
    sourceSheetIndex: 0,
    metricMappings: [
      createMetricMapping("amount"),
      createMetricMapping("inquiry"),
      createMetricMapping("order")
    ]
  });
  const responseTimeProfile = createReportProfile("response_time", {
    displayName: "平均响应时间",
    downloadMode: "single_file",
    sourceSheetMode: "single_sheet",
    sourceSheetName: "按客服查看",
    sourceSheetIndex: 0,
    metricMappings: createDefaultMetricMappingsForReport("response_time")
  });

  return {
    key: "",
    displayName: "",
    username: "",
    password: "",
    downloadDir: "",
    usesGlobalExportDateRange: true,
    exportDateRange: resolveExportDateRangeToManualConfig(
      createExportDateRangeConfig({
        startType: "month_start",
        startOffsetDays: 0,
        endType: "today",
        endOffsetDays: -1
      }),
      createExportDateRangeConfig({
        startType: "month_start",
        startOffsetDays: 0,
        endType: "today",
        endOffsetDays: -1
      }),
      "默认店铺导出日期"
    ),
    reportProfiles: {
      performance: performanceProfile,
      response_time: responseTimeProfile
    }
  };
}

module.exports = {
  createFallbackStoreTemplate
};
