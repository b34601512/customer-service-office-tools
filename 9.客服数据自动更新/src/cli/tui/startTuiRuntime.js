// TUI 入口：初始化运行目录与配置，把六个页面、状态总线和服务接在一起。
// 页面只消费 services 的快照数据；重量级依赖按需加载，保证首屏秒开。
const ansi = require("./ansi");
const { fit } = require("./width");
const { TuiApp } = require("./tuiApp");
const { formatDurationMs } = require("./format");
const { createOverviewPage, isSummaryRunning } = require("./pages/overview");
const { createTasksPage } = require("./pages/tasks");
const { createStorePage } = require("./pages/stores");
const { createSettingsPage } = require("./pages/settings");
const { createKdocsPage } = require("./pages/kdocs");
const { createHelpPage } = require("./pages/help");
const { createTuiServices } = require("./tuiServices");
const { CLI_VERSION } = require("../cliConstants");
const { isKdocsSyncConfigured } = require("../../kdocsSync/kdocsSyncSettings");
const { 最大化当前控制台窗口 } = require("../../../../共享CLI/最大化控制台窗口");

function buildStatusLines(ctx, app) {
  const state = ctx.services.getState();
  const lines = [];
  const running = isSummaryRunning(state);
  const tasks = state.summaryTasks || [];
  const successCount = tasks.filter((task) => task.status === "success").length;
  const errorCount = tasks.filter((task) => task.status === "error").length;
  const runningCount = tasks.filter((task) => task.status === "running").length;

  let line1 = `汇总 ${ansi.colorize(running ? "[运行中]" : tasks.length ? "[已结束]" : "[空闲]", running ? "brightYellow" : tasks.length ? "gray" : "gray")}`;
  if (running && state.summaryRunStartedAt) {
    line1 += `  已运行 ${formatDurationMs(Date.now() - new Date(state.summaryRunStartedAt).getTime())}`;
  }
  if (tasks.length) {
    line1 += `  完成 ${successCount} 失败 ${errorCount}${runningCount ? ` 运行 ${runningCount}` : ""}`;
  }
  try {
    const projectConfig = ctx.services.readConfig();
    const storeCount = ctx.services.buildTasks(projectConfig).length;
    line1 += `  启用店铺 ${storeCount}`;
    const kdocsSettings = projectConfig?.kdocsDataDetailSync;
    const kdocsReady = (
      isKdocsSyncConfigured(kdocsSettings, "sync") &&
      isKdocsSyncConfigured(kdocsSettings, "filter") &&
      isKdocsSyncConfigured(kdocsSettings, "customerServiceName")
    );
    line1 += `  金山 ${ansi.colorize(kdocsReady ? "[已配置]" : "[未配置完整]", kdocsReady ? "brightGreen" : "yellow")}`;
  } catch (_configError) {
    // 配置读取失败时状态栏只显示汇总部分，页面内会给出具体错误。
  }
  lines.push(fit(line1, app.columns));

  const outcomeText = state.summaryResult?.detail || state.lastAction || state.lastError || "选择总览页的“开始汇总”即可运行。";
  lines.push(ansi.colorize(fit(` ${outcomeText}`, app.columns), "gray"));
  return lines;
}

async function startTuiRuntime(dependencies = {}) {
  const initializeLayout = dependencies.initializeRuntimeLayout || require("../../config/runtimeLayoutService").initializeRuntimeLayout;
  const initializeConfig = dependencies.initializeProjectConfigForStartup || require("../../config/projectConfigServiceParts/projectConfigInitialization").initializeProjectConfigForStartup;
  const resetApplicationShutdownSignal = dependencies.resetApplicationShutdownSignal || require("../../shared/applicationShutdownSignal").resetApplicationShutdownSignal;
  const scheduleStartupCleanup = dependencies.scheduleStartupCleanup || require("../cliStartupCleanup").scheduleStartupCleanup;

  process.title = "客服数据自动更新 CLI";
  最大化当前控制台窗口();
  initializeLayout();
  resetApplicationShutdownSignal();
  initializeConfig();

  const services = createTuiServices(dependencies.servicesOptions ? { ...dependencies.servicesOptions } : {});
  const pages = [
    createOverviewPage(),
    createTasksPage(),
    createStorePage(),
    createSettingsPage(),
    createKdocsPage(),
    createHelpPage()
  ];
  const ctx = { services };
  pages.forEach((page) => { page.ctx = ctx; });

  let exitResolved = false;
  const app = new TuiApp({
    title: `客服数据自动更新 ${CLI_VERSION}`,
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
  // 首屏已渲染，浏览器缓存清理等耗时收尾放到后台执行。
  scheduleStartupCleanup();

  async function requestExit(reason) {
    if (exitResolved) return;
    exitResolved = true;
    app.stop();
    clearInterval(tickTimer);
    if (typeof unsubscribeState === "function") unsubscribeState();
    const { shutdownCliResources } = require("../cliShutdown");
    await shutdownCliResources().catch(() => {});
    process.exit(0);
  }
  process.once("SIGTERM", () => requestExit("SIGTERM"));
  // TUI 原始模式下 Ctrl+C 由框架拦截并弹出确认；SIGINT 作为兜底。
  process.once("SIGINT", () => requestExit("SIGINT"));

  return app;
}

module.exports = { startTuiRuntime, buildStatusLines };
