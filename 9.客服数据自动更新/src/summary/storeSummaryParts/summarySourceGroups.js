const { resolveStoreReportProfile, buildReportScopedStoreConfig } = require("../../config/storeReportProfileHelpers");
const { listEnabledReportModules } = require("../../config/reportModuleDefinitions");

function resolveSummarySourceKey(platformKey, storeKey, resolvedConfig) {
  // 这个函数只把真实下载来源转换成稳定分组键。
  const store = resolvedConfig?.activeStore || {};
  return [
    platformKey,
    storeKey,
    store.siteUrl || "",
    store.downloadMode || "",
    store.sourceSheetMode || "",
    store.sourceSheetName || ""
  ].join("|");
}

function listMatchingHistoricalReportKeys(projectConfig, task, sourceKey) {
  // 这个函数只补充与当前真实来源相同的历史报表键，让旧轮次文件仍可准确识别。
  const platformConfig = projectConfig?.[task.platformKey];
  const rawStore = platformConfig?.stores?.find((store) => store.key === task.storeKey);
  if (!rawStore) {
    return [];
  }
  return listEnabledReportModules()
    .map((reportModule) => reportModule.key)
    .filter((reportKey) => {
      const reportProfile = resolveStoreReportProfile(rawStore, reportKey);
      const scopedStore = buildReportScopedStoreConfig(rawStore, reportProfile);
      return resolveSummarySourceKey(task.platformKey, task.storeKey, { activeStore: scopedStore }) === sourceKey;
    });
}

function resolveDownloadReportKey(platformKey, reportKeys) {
  // 这个函数只选择一组真实来源应使用的官方下载入口。
  if (platformKey === "tmall" && reportKeys.some((key) => key === "response_time" || key === "three_minute_response_rate")) {
    return "response_time";
  }
  return reportKeys[0];
}

function buildSummarySourceGroups(reportContexts, task, projectConfig = null) {
  // 这个函数只把目标表配置按真实来源合并成最小下载清单。
  const groupMap = new Map();
  for (const context of reportContexts) {
    const sourceKey = resolveSummarySourceKey(task.platformKey, task.storeKey, context.resolvedConfig);
    const current = groupMap.get(sourceKey) || { sourceKey, contexts: [] };
    current.contexts.push(context);
    groupMap.set(sourceKey, current);
  }
  return Array.from(groupMap.values()).map((group) => {
    const reportKeys = group.contexts.map((context) => context.reportKey);
    return {
      ...group,
      reportKeys,
      reuseReportKeys: [...new Set([...reportKeys, ...listMatchingHistoricalReportKeys(projectConfig, task, group.sourceKey)])],
      downloadReportKey: resolveDownloadReportKey(task.platformKey, reportKeys),
      label: group.contexts
        .map((context) => context.resolvedConfig.activeStore.activeReportDisplayName || context.reportKey)
        .join("＋")
    };
  });
}

module.exports = {
  buildSummarySourceGroups
};
