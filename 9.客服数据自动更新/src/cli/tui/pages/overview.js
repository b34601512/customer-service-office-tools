// 总览页只展示关键状态；具体操作统一由顶部横向分页承载。
const path = require("path");
const ansi = require("../ansi");
const { PLATFORM_META } = require("../../cliConstants");
const { formatGlobalDateMode, resolveSummaryRunOutcome } = require("../../cliDashboard");
const { isKdocsSyncConfigured } = require("../../../kdocsSync/kdocsSyncSettings");

function countPlatformStores(projectConfig) {
  return Object.keys(PLATFORM_META).map((platformKey) => {
    const stores = projectConfig?.[platformKey]?.stores || [];
    return `${PLATFORM_META[platformKey].label} ${stores.filter((store) => store.includedInSummary !== false).length}/${stores.length}`;
  }).join("   ");
}

function isSummaryRunning(state) {
  return Boolean(state?.summaryRunStartedAt) && !state?.summaryRunFinishedAt;
}

function createOverviewPage() {
  const page = {
    key: "1",
    title: "总览",
    render(app) {
      const ctx = app.ctx;
      const state = ctx.services.getState();
      const projectConfig = ctx.services.readConfig();
      const lines = [];

      const tasks = ctx.services.buildTasks(projectConfig);
      const runningCount = (state.summaryTasks || []).filter((task) => task.status === "running").length;
      lines.push(ansi.colorize("店铺概览", "brightBlue") + `   ${countPlatformStores(projectConfig)}`);
      lines.push(`启用店铺  ${tasks.length} 家${runningCount ? `    运行中 ${runningCount} 家` : ""}`);
      lines.push(`日期方式  ${formatGlobalDateMode(projectConfig)}`);
      lines.push(`汇总文件  ${path.basename(projectConfig?.workbook?.path || "未设置")}`);

      const kdocsSettings = projectConfig?.kdocsDataDetailSync;
      const kdocsConfigured = (
        isKdocsSyncConfigured(kdocsSettings, "sync") &&
        isKdocsSyncConfigured(kdocsSettings, "filter") &&
        isKdocsSyncConfigured(kdocsSettings, "customerServiceName")
      );
      lines.push(`金山同步  ${kdocsConfigured ? ansi.colorize("已配置三脚本", "brightGreen") : ansi.colorize("未配置完整", "yellow")}`);

      const outcome = resolveSummaryRunOutcome(state, state.summaryTasks || []);
      const recentText = outcome
        ? `${ansi.colorize(outcome.title, outcome.kind === "error" ? "brightRed" : "brightGreen")} ${outcome.detail}（${outcome.finishedAtText}）`
        : state?.lastAction || "暂无运行记录";
      lines.push(`最近结果  ${recentText}`);
      if (state?.lastError) {
        lines.push(ansi.colorize(`最近错误  ${state.lastError}`, "brightRed"));
      }
      return lines;
    },
    footer() {
      return "←→或数字键切页 | 0退出 Ctrl+C确认退出";
    }
  };
  return page;
}

module.exports = { createOverviewPage, countPlatformStores, isSummaryRunning };
