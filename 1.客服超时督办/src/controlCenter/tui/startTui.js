// TUI 入口：把控制台服务、运行状态、日志总线与七个页面接在一起。
// 页面只消费 ctx.cache 的快照数据，服务动作统一走 ctx.services，避免页面直接触碰文件系统。
const ansi = require("./ansi");
const { TuiApp } = require("./tuiApp");
const { fit } = require("./width");
const { formatDurationMs, formatTaskStatus, formatLoginStatus } = require("./format");
const { createOverviewPage } = require("./pages/overview");
const { createCustomersPage } = require("./pages/customers");
const { createLogsPage } = require("./pages/logs");
const { createConfigPage } = require("./pages/config");
const { createWecomPage } = require("./pages/wecom");
const { createResourcesPage } = require("./pages/resources");
const { createReportsPage } = require("./pages/reports");
const appConfig = require("../../config/appConfig");
const { readControlCenterConfig } = require("../controlCenterConfigService");
const { saveControlCenterConfig, readWecomRobotConfig, saveWecomRobotConfig } = require("../controlCenterConfigService");
const { readDashboardSnapshot } = require("../controlCenterDashboardService");
const { readLoginStatus } = require("../../features/loginStatusStore");
const { readControlCenterResourceUsage } = require("../controlCenterResourceMonitor");
const { loadTimeoutPerformanceLedger } = require("../../features/timeoutPerformance/timeoutPerformanceLedger");

function createServices(options) {
  const taskService = options.taskService;
  return {
    readConfig: () => readControlCenterConfig(),
    saveConfig: (payload) => saveControlCenterConfig(payload),
    readWecom: () => readWecomRobotConfig(),
    saveWecom: (payload) => saveWecomRobotConfig(payload),
    readDashboard: () => readDashboardSnapshot(readControlCenterConfig()),
    readLoginStatus: () => readLoginStatus(appConfig.loginStatusPath),
    readResources: () =>
      readControlCenterResourceUsage({
        rootPids: options.getResourceRootPids()
      }),
    startTask: async (taskName) => {
      await taskService.startTask(taskName);
    },
    stopTask: async () => {
      await taskService.stopCurrentTask();
    },
    confirmLogin: () => taskService.confirmLoginCompleted(),
    requestExit: () => options.shutdown("TUI 用户退出控制台"),
    readPerformanceLedger: () => loadTimeoutPerformanceLedger()
  };
}

function buildStatusLines(ctx, app, serverPort) {
  const state = ctx.state;
  const task = state.currentTask;
  const lines = [];

  const taskStatus = formatTaskStatus(task);
  let line1 = `任务 ${ansi.colorize(`[${taskStatus.label}]`, taskStatus.color)} ${task ? task.label || task.taskName : "无"}`;
  if (task?.status === "running" && task?.startedAt) {
    line1 += `  已运行 ${formatDurationMs(Date.now() - new Date(task.startedAt).getTime())}`;
  }
  if (task?.pid) {
    line1 += `  PID=${task.pid}`;
  }
  const login = formatLoginStatus(ctx.cache.loginStatus);
  line1 += `  登录 ${ansi.colorize(`[${login.label}]`, login.color)}`;
  const summary = ctx.cache.dashboard?.monitorSummary;
  if (summary) {
    const attention = Number(summary.attentionCount || 0);
    line1 += `  需关注客户 ${attention > 0 ? ansi.colorize(String(attention), "brightRed") : "0"}`;
  }
  lines.push(fit(line1, app.columns));

  if (state.currentTask?.awaitingConfirmation) {
    app.needsLoginConfirm = true;
    lines.push(ansi.colorize(fit("⚠ 请在程序打开的浏览器里完成登录，完成后按【回车】确认", app.columns), "brightYellow"));
  } else {
    app.needsLoginConfirm = false;
    if (task?.message) {
      lines.push(fit(`   ${task.message}`, app.columns));
    } else {
      lines.push(fit(`   本地服务 http://127.0.0.1:${serverPort}（网页版仍可访问）`, app.columns));
    }
  }

  return lines;
}

function createTui(options) {
  // options: { state, taskService, shutdown, getResourceRootPids, serverPort, output? }
  const pages = [
    createOverviewPage(),
    createCustomersPage(),
    createLogsPage(),
    createConfigPage(),
    createWecomPage(),
    createResourcesPage(),
    createReportsPage()
  ];

  const ctx = {
    state: options.state,
    taskService: options.taskService,
    cache: {
      dashboard: null,
      loginStatus: readLoginStatus(appConfig.loginStatusPath)
    },
    services: createServices(options)
  };

  pages.forEach((page) => {
    page.ctx = ctx;
  });

  const logsPage = pages.find((page) => page.key === "3");

  const app = new TuiApp({
    title: "客服督办控制台",
    pages,
    output: options.output,
    onExitRequest: () => {
      ctx.services.requestExit();
    },
    onLoginConfirm: () => {
      try {
        ctx.services.confirmLogin();
      } catch (error) {
        // 这里确认失败只留日志，不打断用户操作，真正原因会出现在日志页。
      }
    },
    statusBarProvider: (tuiApp) => buildStatusLines(ctx, tuiApp, options.serverPort)
  });
  app.ctx = ctx;

  // 日志总线：初始缓冲 + 实时追加，全部进日志页环形缓冲。
  const handleLogEvent = ({ line }) => {
    logsPage.pushLine(line);
    app.requestRender();
  };
  const handleStateEvent = () => {
    app.requestRender();
  };
  (options.state.logLines || []).forEach((line) => logsPage.pushLine(line));
  options.state.eventBus.on("log", handleLogEvent);
  options.state.eventBus.on("state", handleStateEvent);

  const refreshDashboard = () => {
    try {
      ctx.cache.dashboard = ctx.services.readDashboard();
      ctx.cache.loginStatus = ctx.services.readLoginStatus();
    } catch (error) {
      // 这里缓存刷新失败不打断 TUI，下一页渲染仍展示最后一次成功快照。
    }
    app.requestRender();
  };

  const tickTimer = setInterval(() => app.requestRender(), 1000);
  const dashboardTimer = setInterval(refreshDashboard, 3000);
  if (typeof tickTimer.unref === "function") {
    tickTimer.unref();
  }
  if (typeof dashboardTimer.unref === "function") {
    dashboardTimer.unref();
  }

  // 这里先取一次首屏数据，避免用户进入 TUI 时看到空白面板。
  refreshDashboard();

  return {
    app,
    dispose() {
      clearInterval(tickTimer);
      clearInterval(dashboardTimer);
      options.state.eventBus.removeListener("log", handleLogEvent);
      options.state.eventBus.removeListener("state", handleStateEvent);
    }
  };
}

module.exports = {
  createTui,
  buildStatusLines
};
