// 该文件用于解决项目默认配置入口聚合和对外接口注册问题。
const {
  createMetricMapping,
  createDefaultStoreDownloadDir,
  createDefaultDownloadRootDir,
  createDefaultManualExportDateRange,
  createDefaultExportDateAutomationConfig,
  createGlobalPerformanceReportDefaults
} = require("./projectConfigDefaultParts/defaultConfigBuilders");
const { createTmallDefaultConfig } = require("./projectConfigDefaultParts/tmallDefaultConfig");
const { createJdDefaultConfig } = require("./projectConfigDefaultParts/jdDefaultConfig");
const { createPddDefaultConfig } = require("./projectConfigDefaultParts/pddDefaultConfig");
const { createDouyinDefaultConfig } = require("./projectConfigDefaultParts/douyinDefaultConfig");

function createDefaultProjectConfig(baseDate = new Date()) {
  // 这里集中维护默认项目配置入口，平台细节分别放在各自默认配置文件里。
  const defaultGlobalExportDateRange = createDefaultManualExportDateRange(baseDate);

  const tmall = createTmallDefaultConfig(baseDate);
  const jd = createJdDefaultConfig(baseDate);
  const pdd = createPddDefaultConfig(baseDate);
  const douyin = createDouyinDefaultConfig(baseDate);
  return {
    workbook: {
      path: ""
    },
    kdocsDataDetailSync: {
      documentUrl: "",
      syncWebhookUrl: "",
      syncApiToken: "",
      filterWebhookUrl: "",
      filterApiToken: "",
      customerServiceNameWebhookUrl: "",
      customerServiceNameApiToken: ""
    },
    globalDefaults: {
      downloadRootDir: createDefaultDownloadRootDir(),
      exportDateMode: "automatic",
      exportDateAutomation: createDefaultExportDateAutomationConfig(),
      exportDateRange: defaultGlobalExportDateRange,
      reportProfiles: {
        performance: createGlobalPerformanceReportDefaults()
      }
    },
    tmall,
    jd,
    pdd,
    douyin
  };
}

module.exports = {
  createMetricMapping,
  createDefaultStoreDownloadDir,
  createDefaultDownloadRootDir,
  createDefaultExportDateAutomationConfig,
  createGlobalPerformanceReportDefaults,
  createDefaultProjectConfig
};
