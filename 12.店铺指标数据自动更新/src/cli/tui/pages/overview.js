// 总览页：游戏化仪表盘 + 动作列表。统计复用 cliDashboard 的纯函数，最近结果按 TUI 重写。
const path = require("path");
const ansi = require("../ansi");
const { fit } = require("../width");
const { spinner, titleBanner, progressBar } = require("../gameUi");
const {
  getStoreCompletionSummary,
  formatEnabledPlatformCounts,
  formatDateSelection,
  splitDashboardStoreNames
} = require("../../cliDashboard");
const { CLI_VERSION } = require("../../cliConstants");

function findPageIndex(app, key) {
  return app.pages.findIndex((pageItem) => pageItem.key === key);
}

function formatRecentResultForTui(state, taskHistory) {
  if (state?.result) {
    let text = `新采集 ${state.result.collectedCount || 0} 家`;
    if ((state.result.skippedCount || 0) > 0) {
      text += `，跳过 ${state.result.skippedCount} 家`;
    }
    if ((state.result.errorCount || 0) > 0) {
      text += `，${ansi.colorize(`失败 ${state.result.errorCount} 家`, "brightRed")}`;
    }
    return text;
  }
  const recentRecord = (taskHistory?.storeMetricRuns || [])[0];
  if (!recentRecord) return "暂无运行记录";
  return `${recentRecord.storeDisplayName || recentRecord.storeKey} · ${recentRecord.metricCount} 项 · ${recentRecord.runDate}`;
}

function runOpenAction(app, page, serviceMethod, successMessage) {
  return async () => {
    page.state.message = `正在打开${successMessage}…`;
    app.requestRender();
    try {
      await app.ctx.services[serviceMethod]();
      page.state.message = `已打开${successMessage}。`;
    } catch (error) {
      page.state.message = `打开失败：${String(error?.message || error)}`;
    }
    app.requestRender();
  };
}

function createOverviewPage() {
  const page = {
    key: "1",
    title: "总览",
    state: { selection: 0, message: "" },
    onEnter(app) {
      this.state.selection = 0;
    },
    getActions(app) {
      return [
        {
          label: "开始汇总",
          run: (app) => {
            const tasksIndex = findPageIndex(app, "2");
            app.switchPage(tasksIndex);
            app.pages[tasksIndex].startRun(app, {
              forceRecollect: false,
              collectionScope: { type: "all" }
            });
          }
        },
        {
          label: "强制重新采集",
          run: (app) => {
            const tasksIndex = findPageIndex(app, "2");
            app.switchPage(tasksIndex);
            app.pages[tasksIndex].startForceRecollect(app);
          }
        },
        { label: "店铺管理", run: (app) => app.switchPage(findPageIndex(app, "3")) },
        { label: "金山文档同步", run: (app) => app.switchPage(findPageIndex(app, "5")) },
        {
          label: "打开凭证文件夹",
          run: runOpenAction(app, page, "openRecentEvidenceFolder", "凭证文件夹")
        },
        {
          label: "打开汇总文件夹",
          run: runOpenAction(app, page, "openWorkbookDirectory", "汇总文件夹")
        },
        { label: "退出控制台", run: (app) => app.onExitRequest() }
      ];
    },
    render(app) {
      const services = app.ctx.services;
      const state = services.getState();
      const config = services.readConfig();
      const taskHistory = services.readTaskHistory();
      const columns = app.columns;
      const lines = [];

      lines.push(...titleBanner(`◆ 店铺指标数据自动更新 ${CLI_VERSION} ◆`, columns - 2));

      // 运行状态 + 旋转指示器
      const running = state.status === "running";
      const statusText = running
        ? "[运行中]"
        : state.status === "success"
          ? "[已完成]"
          : state.status === "partial_error"
            ? "[部分失败]"
            : state.status === "error"
              ? "[失败]"
              : "[空闲]";
      const statusColor = running
        ? "brightYellow"
        : state.status === "error"
          ? "brightRed"
          : state.status === "partial_error"
            ? "yellow"
            : state.status === "success"
              ? "brightGreen"
              : "gray";
      lines.push(` ${ansi.colorize(statusText, statusColor)}${running ? ` ${spinner(Math.floor(Date.now() / 1000))}` : ""}`);

      // 今日完成血条
      const completionSummary = getStoreCompletionSummary(config, taskHistory);
      const enabledCount = completionSummary.enabledStores.length;
      const completedCount = completionSummary.completedStores.length;
      lines.push(` 今日完成  ${progressBar(completedCount, enabledCount, columns - 10)}`);

      // 已完成/未完成列表
      const completedNames = completionSummary.completedStores.map((store) => store.displayName || store.key || "未命名店铺");
      const pendingNames = completionSummary.pendingStores.map((store) => store.displayName || store.key || "未命名店铺");
      const completedWrapped = splitDashboardStoreNames(completedNames);
      const pendingWrapped = splitDashboardStoreNames(pendingNames);
      if (completedWrapped.length) {
        lines.push(` ${ansi.colorize("已完成", "brightGreen")}  ${ansi.colorize(completedWrapped[0], "brightGreen")}`);
        for (const wrappedName of completedWrapped.slice(1)) {
          lines.push(`         ${ansi.colorize(wrappedName, "brightGreen")}`);
        }
      } else {
        lines.push(` ${ansi.colorize("已完成", "brightGreen")}  暂无`);
      }
      if (pendingWrapped.length) {
        lines.push(` ${ansi.colorize("未完成", "brightRed")}  ${ansi.colorize(pendingWrapped[0], "brightRed")}`);
        for (const wrappedName of pendingWrapped.slice(1)) {
          lines.push(`         ${ansi.colorize(wrappedName, "brightRed")}`);
        }
      } else {
        lines.push(` ${ansi.colorize("未完成", "brightRed")}  暂无`);
      }

      // 平台/日期/汇总文件/金山
      lines.push(` 平台分布  ${formatEnabledPlatformCounts(config)}`);
      lines.push(` 日期方式  ${formatDateSelection(config?.dateSelection)}`);
      lines.push(` 汇总文件  ${path.basename(config?.workbook?.path || "未设置")}`);
      lines.push(` 金山同步  ${services.isKdocsSyncConfigured(config) ? ansi.colorize("[已配置]", "brightGreen") : ansi.colorize("[未配置]", "yellow")}`);
      lines.push(` 最近结果  ${formatRecentResultForTui(state, taskHistory)}`);

      // 动作面板
      lines.push("");
      lines.push(ansi.colorize("── 操作 ──", "brightCyan"));
      this.getActions(app).forEach((action, index) => {
        const row = ` ${index === this.state.selection ? "▶" : " "} ${action.label}`;
        lines.push(index === this.state.selection ? ansi.colorize(fit(row, columns), "reverse") : row);
      });
      if (this.state.message) {
        lines.push(ansi.colorize(` ${this.state.message}`, "brightYellow"));
      }
      return lines;
    },
    footer() {
      return "↑↓选择 回车执行   ←→/数字键切页   0退出   Ctrl+C确认退出";
    },
    handleKey(key, app) {
      const actionCount = Math.max(1, this.getActions(app).length);
      if (key === "up") {
        this.state.selection = (this.state.selection - 1 + actionCount) % actionCount;
        return true;
      }
      if (key === "down") {
        this.state.selection = (this.state.selection + 1) % actionCount;
        return true;
      }
      if (key === "enter") {
        const action = this.getActions(app)[this.state.selection];
        if (action) action.run(app);
        return true;
      }
      if (key === "0") {
        app.onExitRequest();
        return true;
      }
      return false;
    }
  };
  return page;
}

module.exports = {
  createOverviewPage,
  findPageIndex,
  formatRecentResultForTui
};