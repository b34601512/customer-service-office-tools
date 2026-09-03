// 总览页：展示关键状态 + 承载“↑↓选择 回车执行”的快捷操作菜单（对齐1号项目，#630）。
// 快捷动作真源在 summaryRunActions，与汇总页 S/F 键共用同一执行入口。
const path = require("path");
const ansi = require("../ansi");
const { fit } = require("../width");
const { PLATFORM_META } = require("../../cliConstants");
const { formatGlobalDateMode, resolveSummaryRunOutcome } = require("../../cliDashboard");
const { isKdocsSyncConfigured } = require("../../../kdocsSync/kdocsSyncSettings");
const { SUMMARY_ACTIONS, getSummaryRunController } = require("./summaryRunActions");

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
  const controller = getSummaryRunController();
  const page = {
    key: "1",
    title: "总览",
    state: { selection: 0 },
    render(app) {
      const ctx = app.ctx;
      const state = ctx.services.getState();
      const projectConfig = ctx.services.readConfig();
      const columns = app.columns || 100;
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

      // 快捷操作菜单：↑↓选择、回车执行；运行中置灰禁用。
      const running = isSummaryRunning(state) || controller.busy;
      if (this.state.selection >= SUMMARY_ACTIONS.length) {
        this.state.selection = 0;
      }
      lines.push("");
      lines.push(ansi.colorize("快捷操作（↑↓选择 回车执行）", "brightBlue"));
      SUMMARY_ACTIONS.forEach((action, index) => {
        const disabled = running && !action.alwaysEnabled;
        const selected = index === this.state.selection && !disabled;
        const text = disabled ? `${action.label}（汇总运行中，暂不可执行）` : action.label;
        const line = `${selected ? "▶ " : "  "}${text}`;
        if (disabled) {
          lines.push(ansi.colorize(fit(line, columns), "gray"));
        } else if (selected) {
          lines.push(ansi.colorize(fit(line, columns), "reverse"));
        } else {
          lines.push(fit(line, columns));
        }
      });
      if (controller.message) {
        lines.push("");
        lines.push(ansi.colorize(`提示：${controller.message}`, "brightYellow"));
      }
      return lines;
    },
    handleKey(key, app) {
      const state = app.ctx.services.getState();
      const running = isSummaryRunning(state) || controller.busy;
      if (key === "up" || key === "down") {
        const direction = key === "down" ? 1 : -1;
        this.state.selection = (this.state.selection + direction + SUMMARY_ACTIONS.length) % SUMMARY_ACTIONS.length;
        return true;
      }
      if (key === "enter") {
        const action = SUMMARY_ACTIONS[this.state.selection];
        if (action.id === "exit") {
          // 与 Ctrl+C 同一条退出确认流（复用 tuiApp 内置 exitConfirmPending 机制）。
          app.exitConfirmPending = true;
          return true;
        }
        if (running) {
          controller.message = "汇总正在进行中，请在汇总页查看进度或等待完成。";
          app.requestRender();
          return true;
        }
        controller.runAction(app, action.id);
        return true;
      }
      return false;
    },
    footer() {
      return "↑↓选择 回车执行快捷操作 | ←→或数字键切页 | 0退出 Ctrl+C确认退出";
    }
  };
  return page;
}

module.exports = { createOverviewPage, countPlatformStores, isSummaryRunning };
