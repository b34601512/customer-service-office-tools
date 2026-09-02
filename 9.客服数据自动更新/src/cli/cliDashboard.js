const path = require("path");
const { buildConfiguredSummaryTasks } = require("../controlCenter/summaryTaskPlanner");
const { isKdocsSyncConfigured } = require("../kdocsSync/kdocsSyncSettings");
const { CLI_VERSION, CLI_BRAND_METADATA, PLATFORM_META } = require("./cliConstants");

const DIVIDER = "─".repeat(72);

function formatCliBrandMetadata() {
  return (
    `作者：${CLI_BRAND_METADATA.authorDisplayName}    ` +
    `微信：${CLI_BRAND_METADATA.officialWechatId}    ` +
    `官网：${CLI_BRAND_METADATA.officialWebsiteUrl}`
  );
}

function formatLocalDateTime(date) {
  const parts = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")];
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map((value) => String(value).padStart(2, "0")).join(":");
  return `${parts.join("-")} ${time}`;
}

function resolveSummaryRunOutcome(dashboardState, tasks) {
  const finishedAt = dashboardState?.summaryRunFinishedAt ? new Date(dashboardState.summaryRunFinishedAt) : null;
  if (!finishedAt || Number.isNaN(finishedAt.getTime())) return null;
  const configuredTasks = Array.isArray(tasks) ? tasks.filter((task) => task?.id !== "backend-disconnected") : [];
  const successCount = configuredTasks.filter((task) => task.status === "success").length;
  const errorCount = configuredTasks.filter((task) => task.status === "error").length;
  if (!configuredTasks.length || successCount + errorCount !== configuredTasks.length) return null;
  if (errorCount) return {
    kind: "error", title: "⚠️ 本次汇总存在失败",
    detail: `共 ${configuredTasks.length} 家店铺：成功 ${successCount} 家，失败 ${errorCount} 家；请查看失败店铺的红色行和凭证。`,
    finishedAtIso: finishedAt.toISOString(), finishedAtText: formatLocalDateTime(finishedAt)
  };
  return {
    kind: "success", title: "🎉 本次汇总圆满完成！",
    detail: `共 ${configuredTasks.length} 家店铺全部成功，数据已写入汇总表。`,
    finishedAtIso: finishedAt.toISOString(), finishedAtText: formatLocalDateTime(finishedAt)
  };
}

function resolveSummaryDateRangeOverview(tasks) {
  if (Array.isArray(tasks) && tasks.some((task) => task?.id === "backend-disconnected")) {
    return { text: "当前下载统计范围：后台未连接，暂无法确认", hasDifferentStoreRanges: false };
  }
  const configuredTasks = Array.isArray(tasks) ? tasks.filter((task) => task?.id !== "backend-disconnected") : [];
  const dateTexts = configuredTasks.map((task) => String(task?.exportDateRangeText || "").trim()).filter((text) => text && text !== "日期未配置");
  const uniqueDateTexts = [...new Set(dateTexts)];
  const customStoreCount = configuredTasks.filter((task) => task?.usesGlobalExportDateRange === false).length;
  if (uniqueDateTexts.length === 1 && dateTexts.length === configuredTasks.length) return { text: `当前下载统计范围：${uniqueDateTexts[0]}`, hasDifferentStoreRanges: false };
  if (uniqueDateTexts.length > 1) return {
    text: `当前下载统计范围：存在 ${uniqueDateTexts.length} 组日期，${customStoreCount ? `${customStoreCount} 家为单店自定义` : "各店铺日期不一致"}；详见各店铺。`,
    hasDifferentStoreRanges: true
  };
  return { text: configuredTasks.length ? "当前下载统计范围：日期未配置" : "当前下载统计范围：暂无启用店铺", hasDifferentStoreRanges: false };
}

function formatGlobalDateMode(projectConfig) {
  const defaults = projectConfig?.globalDefaults || {};
  const startDate = defaults.exportDateRange?.start?.customDate || "未设置";
  const endDate = defaults.exportDateRange?.end?.customDate || "未设置";
  if (defaults.exportDateMode === "manual") return `手动 · ${startDate} 至 ${endDate}`;
  return `智能 · 本月1号起，延迟${defaults.exportDateAutomation?.endDateDelayDayCount ?? 2}天 · ${startDate} 至 ${endDate}`;
}

function countPlatformStores(projectConfig) {
  return Object.keys(PLATFORM_META).map((platformKey) => {
    const stores = projectConfig?.[platformKey]?.stores || [];
    return `${PLATFORM_META[platformKey].label}${stores.filter((store) => store.includedInSummary !== false).length}/${stores.length}`;
  }).join("  ");
}

function renderDashboard({ terminal, projectConfig, state }) {
  const tasks = buildConfiguredSummaryTasks(projectConfig);
  const runningCount = (state?.summaryTasks || []).filter((task) => task.status === "running").length;
  const outcome = resolveSummaryRunOutcome(state, state?.summaryTasks || []);
  terminal.clear();
  terminal.writeLine(terminal.theme.title(`客服数据自动更新  ${CLI_VERSION}`));
  terminal.writeLine(terminal.theme.muted(formatCliBrandMetadata()));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(`${terminal.theme.heading("店铺概览")}  ${countPlatformStores(projectConfig)}`);
  terminal.writeLine(`启用店铺  ${tasks.length} 家${runningCount ? `    运行中 ${runningCount} 家` : ""}`);
  terminal.writeLine(`日期方式  ${formatGlobalDateMode(projectConfig)}`);
  terminal.writeLine(`汇总文件  ${path.basename(projectConfig?.workbook?.path || "未设置")}`);
  const kdocsSettings = projectConfig?.kdocsDataDetailSync;
  const kdocsConfigured = (
    isKdocsSyncConfigured(kdocsSettings, "sync") &&
    isKdocsSyncConfigured(kdocsSettings, "filter") &&
    isKdocsSyncConfigured(kdocsSettings, "customerServiceName")
  );
  terminal.writeLine(`金山同步  ${kdocsConfigured ? "已配置三脚本" : "未配置完整"}`);
  terminal.writeLine(`最近结果  ${outcome ? `${outcome.detail}（${outcome.finishedAtText}）` : state?.lastAction || "暂无运行记录"}`);
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(terminal.theme.heading("操作"));
  terminal.writeLine("  [1] 开始汇总       [2] 平台/店铺管理       [3] 日期方式");
  terminal.writeLine("  [4] 汇总表设置     [5] 客服设置            [6] 打开凭证/源文件夹");
  terminal.writeLine("  [7] 打开汇总文件夹 [8] 下载根目录          [9] 更新已有明细岗位");
  terminal.writeLine("  [A] 金山文档同步   [B] 强制重新下载       [H] 使用说明");
  terminal.writeLine("  [0] 退出");
  terminal.writeLine(terminal.theme.muted(DIVIDER));
}

module.exports = {
  DIVIDER,
  formatCliBrandMetadata,
  formatGlobalDateMode,
  resolveSummaryRunOutcome,
  resolveSummaryDateRangeOverview,
  renderDashboard
};
