// TUI 入口：初始化运行目录与配置，把六个页面、状态总线和服务接在一起。
// 页面只消费 services 的快照数据；重量级依赖按需加载，保证首屏秒开。
// 退出只关托管 Chrome（closeManagedChrome），不引入 #9 专有的 shutdown 流程。
const ansi = require("./ansi");
const { fit } = require("./width");
const { TuiApp } = require("./tuiApp");
const { createOverviewPage } = require("./pages/overview");
const { createTasksPage } = require("./pages/tasks");
const { createStoresPage } = require("./pages/stores");
const { createSettingsPage } = require("./pages/settings");
const { createKdocsPage } = require("./pages/kdocs");
const { createHelpPage } = require("./pages/help");
const { createTuiServices } = require("./tuiServices");
const { CLI_VERSION } = require("../cliConstants");
const { getStoreCompletionSummary } = require("../cliDashboard");
const { 最大化当前控制台窗口 } = require("../../../../共享CLI/最大化控制台窗口");

const STATUS_MAP = {
  idle: { text: "[空闲]", color: "gray" },
  running: { text: "[运行中]", color: "brightYellow" },
  success: { text: "[已完成]", color: "brightGreen" },
  partial_error: { text: "[部分失败]", color: "yellow" },
  error: { text: "[失败]", color: "brightRed" }
};

function buildStatusLines(ctx, app) {
  const services = ctx.services;
  const state = services.getState();
  const lines = [];
  const statusInfo = STATUS_MAP[state.status] || STATUS_MAP.idle;
  let line1 = `状态 ${ansi.colorize(statusInfo.text, statusInfo.color)}`;
  try {
    const config = services.readConfig();
    const taskHistory = services.readTaskHistory();
    const completionSummary = getStoreCompletionSummary(config, taskHistory);
    const enabledCount = completionSummary.enabledStores.length;
    const completedCount = completionSummary.completedStores.length;
    line1 += `  启用店铺 ${enabledCount}`;
    line1 += `  今日完成 ${completedCount}/${enabledCount}`;
  } catch (_configError) {
    // 配置读取失败时状态栏只显示状态，页面内会给出具体错误。
  }
  lines.push(fit(line1, app.columns));

  const stageText = state.stage ? `[${state.stage}]` : "";
  const outcomeText = state.detail || state.error || "选择总览页的“开始汇总”即可运行。";
  lines.push(ansi.colorize(fit(` ${stageText} ${outcomeText}`.trim(), app.columns), "gray"));
  return lines;
}

async function startTuiRuntime(dependencies = {}) {
  const initializeLayout =
    dependencies.initializeRuntimeLayout ||
    require("../../config/runtimeLayoutService").initializeRuntimeLayout;
  const initializeConfig =
    dependencies.ensureStoreMetricConfig ||
    require("../../config/storeMetricConfig").ensureStoreMetricConfig;

  process.title = "店铺指标自动更新 CLI";
  最大化当前控制台窗口();
  initializeLayout();
  initializeConfig();

  const services = createTuiServices(
    dependencies.servicesOptions ? { ...dependencies.servicesOptions } : {}
  );
  const pages = [
    createOverviewPage(),
    createTasksPage(),
    createStoresPage(),
    createSettingsPage(),
    createKdocsPage(),
    createHelpPage()
  ];
  const ctx = { services };
  pages.forEach((page) => {
    page.ctx = ctx;
  });

  let exitResolved = false;
  const app = new TuiApp({
    title: `店铺指标自动更新 ${CLI_VERSION}`,
    pages,
    output: dependencies.output,
    statusBarProvider: (tuiApp) => buildStatusLines(ctx, tuiApp),
    onExitRequest: () => requestExit("TUI 用户退出控制台")
  });
  app.ctx = ctx;

  // 状态总线：汇总进度变化即时重绘。
  const unsubscribeState = services.subscribeState(() => app.requestRender());

  // 时钟与时长每秒刷新。
  const tickTimer = setInterval(() => app.requestRender(), 1000);
  if (typeof tickTimer.unref === "function") tickTimer.unref();

  app.start();

  async function requestExit(reason) {
    if (exitResolved) return;
    exitResolved = true;
    app.stop();
    clearInterval(tickTimer);
    if (typeof unsubscribeState === "function") unsubscribeState();
    await services.shutdown().catch(() => {});
    process.exit(0);
  }
  process.once("SIGTERM", () => requestExit("SIGTERM"));
  // TUI 原始模式下 Ctrl+C 由框架拦截并弹出确认；SIGINT 作为兜底。
  process.once("SIGINT", () => requestExit("SIGINT"));

  return app;
}

module.exports = { startTuiRuntime, buildStatusLines };