const {
  createAutomatedExportDateRangeConfig,
  validateExportDateMode
} = require("../../shared/exportDateRange");
const { clone } = require("./projectConfigValuePrimitives");

const PROJECT_PLATFORM_KEYS = ["tmall", "jd", "pdd", "douyin"];

function applyGlobalExportDateRangeToProjectConfig(projectConfig, options = {}) {
  // 全店保存覆盖全部店铺；启动刷新只覆盖仍跟随全局的店铺。
  const globalExportDateRange = clone(projectConfig?.globalDefaults?.exportDateRange || null);
  if (!globalExportDateRange) {
    return projectConfig;
  }
  PROJECT_PLATFORM_KEYS.forEach((platformKey) => {
    const platform = projectConfig?.[platformKey];
    if (!Array.isArray(platform?.stores)) {
      return;
    }
    platform.stores = platform.stores.map((store) => {
      if (options.onlyStoresFollowingGlobalDateRange && store?.usesGlobalExportDateRange === false) {
        return store;
      }
      return {
        ...store,
        usesGlobalExportDateRange: true,
        exportDateRange: clone(globalExportDateRange)
      };
    });
  });
  return projectConfig;
}

function refreshGlobalExportDateRangeFromAutomation(projectConfig, baseDate = new Date()) {
  // 该函数只根据全店跨度和延迟参数重算总日期。
  projectConfig.globalDefaults.exportDateRange = clone(createAutomatedExportDateRangeConfig(
    projectConfig.globalDefaults.exportDateAutomation,
    baseDate
  ));
  return projectConfig;
}

function buildProjectDateSnapshot(projectConfig) {
  // 这个函数只生成总日期和全部店铺日期的比较快照。
  return JSON.stringify({
    global: projectConfig?.globalDefaults?.exportDateRange || null,
    stores: PROJECT_PLATFORM_KEYS.map((platformKey) =>
      (projectConfig?.[platformKey]?.stores || []).map((store) => ({
        usesGlobalExportDateRange: store?.usesGlobalExportDateRange !== false,
        exportDateRange: store?.exportDateRange || null
      }))
    )
  });
}

function refreshDefaultCompletedExportDateRange(projectConfig, baseDate = new Date()) {
  // 这个函数只在明确启动动作中刷新默认日期，并报告配置是否发生变化。
  if (projectConfig?.globalDefaults?.exportDateMode === "manual") {
    return false;
  }
  const previousDateSnapshot = buildProjectDateSnapshot(projectConfig);
  refreshGlobalExportDateRangeFromAutomation(projectConfig, baseDate);
  applyGlobalExportDateRangeToProjectConfig(projectConfig, {
    onlyStoresFollowingGlobalDateRange: true
  });
  return previousDateSnapshot !== buildProjectDateSnapshot(projectConfig);
}

function synchronizeGlobalExportDateRangeForSave(projectConfig, requestedExportDateMode, baseDate = new Date()) {
  // 保存智能模式时先重算日期；保存手动模式时保留用户填写日期，然后统一覆盖全部店铺。
  const exportDateMode = validateExportDateMode(
    requestedExportDateMode,
    projectConfig?.globalDefaults?.exportDateMode
  );
  projectConfig.globalDefaults.exportDateMode = exportDateMode;
  if (exportDateMode === "automatic") {
    refreshGlobalExportDateRangeFromAutomation(projectConfig, baseDate);
  }
  applyGlobalExportDateRangeToProjectConfig(projectConfig);
  return projectConfig;
}

module.exports = {
  applyGlobalExportDateRangeToProjectConfig,
  refreshGlobalExportDateRangeFromAutomation,
  refreshDefaultCompletedExportDateRange,
  synchronizeGlobalExportDateRangeForSave
};
