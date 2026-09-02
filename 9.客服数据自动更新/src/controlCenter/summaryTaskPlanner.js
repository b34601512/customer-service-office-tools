// 该文件用于解决后端控制台状态按已启用店铺生成首页汇总清单的问题。
const { listEnabledReportModules } = require("../config/reportModuleDefinitions");
const { getPlatformReportRule } = require("../config/platformReportRuleParts/platformReportRuleService");
// 平台中文名单一真源在 cli/cliConstants.js（#598），此处不再复制第二份。
const platformMeta = require("../cli/cliConstants").PLATFORM_META;

function buildSummaryTaskId(platformKey, storeKey) {
  // 这里把任务编号绑定到平台和店铺，一行代表该店本期全部源表。
  return `${String(platformKey || "").trim()}-${String(storeKey || "").trim()}-all`;
}

function resolveReportProfileForSummary(store, reportKey, reportModule) {
  // 首页清单只需要判断启用和展示名，不能因为某个详细配置缺失就让整页报错。
  const reportProfiles =
    store?.reportProfiles && typeof store.reportProfiles === "object" && !Array.isArray(store.reportProfiles)
      ? store.reportProfiles
      : {};
  const reportProfile = reportProfiles[reportKey] || {};
  return {
    key: reportKey,
    displayName: String(
      reportProfile.displayName ||
        reportModule?.displayName ||
        reportModule?.title ||
        reportKey
    ).trim(),
    enabled: Boolean(reportProfiles[reportKey]) && reportProfile.enabled !== false,
    downloadMode: String(reportProfile.downloadMode || "").trim()
  };
}

function isPlatformReportSupportedForSummary(platformKey, reportKey, reportProfile) {
  // 首页清单也按平台真实支持范围过滤，避免异常配置把不能采集的任务放进本次汇总。
  if (reportKey === "performance") {
    return Boolean(getPlatformReportRule(platformKey, "performance", reportProfile?.downloadMode));
  }

  return Boolean(getPlatformReportRule(platformKey, reportKey, reportProfile?.downloadMode));
}

function listEnabledSupportedReportKeys(platformKey, store) {
  // 这个函数只列出本店真正启用且平台支持的数据来源。
  return listEnabledReportModules()
    .map((reportModule) => reportModule.key)
    .filter((reportKey) => {
      const reportProfile = resolveReportProfileForSummary(store, reportKey, {});
      return reportProfile.enabled !== false && isPlatformReportSupportedForSummary(platformKey, reportKey, reportProfile);
    });
}

function resolveConfiguredStoreExportDateRange(store) {
  // 该函数只把店铺实际下载日期整理成首页可直接展示的文本。
  const startText = String(store?.exportDateRange?.start?.customDate || "").trim();
  const endText = String(store?.exportDateRange?.end?.customDate || "").trim();
  return {
    exportDateRangeStartText: startText,
    exportDateRangeEndText: endText,
    exportDateRangeText: startText && endText ? `${startText} 至 ${endText}` : "日期未配置",
    usesGlobalExportDateRange: store?.usesGlobalExportDateRange !== false
  };
}

function buildConfiguredSummaryTasks(projectConfig) {
  // 该函数从配置源头按店铺生成唯一汇总清单，一行覆盖该店全部源表。
  return Object.entries(platformMeta).flatMap(([platformKey, meta]) => {
    const stores = Array.isArray(projectConfig?.[platformKey]?.stores) ? projectConfig[platformKey].stores : [];
    return stores
      .filter((store) => store?.includedInSummary !== false)
      .map((store) => {
        const storeKey = String(store?.key || "").trim();
        const reportKeys = listEnabledSupportedReportKeys(platformKey, store);
        if (!storeKey || reportKeys.length === 0) {
          return null;
        }
          const storeDisplayName = String(store.displayName || storeKey).trim();
          const exportDateRangeView = resolveConfiguredStoreExportDateRange(store);
          return {
          id: buildSummaryTaskId(platformKey, storeKey),
          platformKey,
          platformLabel: meta.label || platformKey,
          storeKey,
          reportKeys,
            storeDisplayName,
            ...exportDateRangeView,
            dataSourceName: `数据明细（${reportKeys.length}份源表）`,
          status: "ready",
          action: "等待开始",
          detail: `点击开始汇总后，将自动取得${storeDisplayName}所需源表并追加到数据明细。`,
          evidenceFiles: []
        };
      })
      .filter(Boolean);
  });
}

function findDashboardTaskForConfiguredTask(dashboardTasks, configuredTask) {
  // 这里按新旧编号和结构化字段匹配运行状态，避免只改展示编号导致进度行断开。
  return dashboardTasks.find((task) => {
    if (!task) {
      return false;
    }
    if (task.id === configuredTask.id) {
      return true;
    }
    return (
      task.platformKey === configuredTask.platformKey &&
      task.storeKey === configuredTask.storeKey
    );
  });
}

function mergeConfiguredSummaryTasks(configuredTasks, dashboardTasks) {
  // 配置决定“本次要跑谁”，后端状态只覆盖这些任务的进度和凭证。
  const safeDashboardTasks = Array.isArray(dashboardTasks) ? dashboardTasks : [];
  return configuredTasks.map((configuredTask) => {
    const dashboardTask = findDashboardTaskForConfiguredTask(safeDashboardTasks, configuredTask);
    if (!dashboardTask) {
      return configuredTask;
    }
    const mergedTask = {
      ...configuredTask,
      ...dashboardTask,
      id: configuredTask.id,
      platformKey: configuredTask.platformKey,
      platformLabel: dashboardTask.platformLabel || configuredTask.platformLabel,
      storeKey: configuredTask.storeKey,
      storeDisplayName: dashboardTask.storeDisplayName || configuredTask.storeDisplayName,
      exportDateRangeStartText: configuredTask.exportDateRangeStartText,
      exportDateRangeEndText: configuredTask.exportDateRangeEndText,
      exportDateRangeText: configuredTask.exportDateRangeText,
      usesGlobalExportDateRange: configuredTask.usesGlobalExportDateRange,
      dataSourceName: dashboardTask.dataSourceName || configuredTask.dataSourceName
    };
    return mergedTask;
  });
}

function resolveSummaryTasksForDashboard(projectConfig, dashboardState) {
  // 首页始终以当前配置为源头，保证勾选启用后清单立即变化。
  const configuredTasks = buildConfiguredSummaryTasks(projectConfig);
  if (!projectConfig) {
    return Array.isArray(dashboardState?.summaryTasks) ? dashboardState.summaryTasks : [];
  }
  return mergeConfiguredSummaryTasks(configuredTasks, dashboardState?.summaryTasks || []);
}

module.exports = {
  platformMeta,
  buildSummaryTaskId,
  listEnabledSupportedReportKeys,
  resolveConfiguredStoreExportDateRange,
  buildConfiguredSummaryTasks,
  mergeConfiguredSummaryTasks,
  resolveSummaryTasksForDashboard
};
