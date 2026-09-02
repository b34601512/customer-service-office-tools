const {
  launchBrowser,
  openLoginEntryPage,
  navigateToTargetPage
} = require("./engine/browser");
const { log, logError, resetCurrentLogFileOnce } = require("./engine/logger");
const { ensureLoginReadyForRun, completeLoginMode } = require("./features/loginFlow");
const { createStopState } = require("./engine/stopSignal");
const {
  runBusinessRuntimeMaintenanceBeforeLaunch,
  runRuntimeMaintenanceOnce,
  startRuntimeMaintenanceLoop
} = require("./engine/runtimeMaintenance/runtimeMaintenance");
const { collectBusinessBrowserDataDirs } = require("./engine/browserCacheSanitizer");
const { monitorOffDutyWorkflow } = require("./features/offDutyClose/offDutyWorkflow");
const { monitorSharedChatWorkflow } = require("./features/chatMonitorRuntime/workflowRunner");
const { monitorOnlinePresenceWorkflow } = require("./features/onlinePresenceMonitor/onlinePresenceWorkflow");

function resolveMode() {
  // 这里明确限制启动模式，避免主管端脚本被错误参数带偏。
  const mode = process.argv[2];

  if (mode === "login" || mode === "run") {
    return mode;
  }

  throw new Error("启动参数错误，请使用 login 或 run。");
}

async function runLoginMode() {
  // 这里专门处理首次人工登录，让主管端后续后台督办直接复用登录态。
  const context = await launchBrowser("login");

  try {
    const page = await openLoginEntryPage(context);
    await completeLoginMode(page);
    log("主线:完成", "主程序", "登录态保存", "首次登录流程完成，后续可直接后台启动");
  } finally {
    await context.close();
  }
}

async function runHeadlessMode() {
  // 这里执行主管端后台模式：未实质回复引擎统一承担超时和漏回复，避免新旧两套提醒同时判断。
  const context = await launchBrowser("run");
  const stopControl = createStopState();
  const stopRuntimeMaintenanceLoop = startRuntimeMaintenanceLoop({
    moduleName: "业务运行膨胀治理"
  });

  try {
    log(
      "主线:完成",
      "主程序",
      "后台督办",
      "主管端已切入「未实质回复监控 + 转接监控 + 上班监控 + 下班监控」轮询，按 Ctrl+C 可结束"
    );
    await Promise.all([
      monitorSharedChatWorkflow(async () => {
        const sharedChatPage = await context.newPage();
        await navigateToTargetPage(sharedChatPage, "聊天监控");
        return sharedChatPage;
      }, stopControl.state),
      monitorOnlinePresenceWorkflow(async () => {
        const onlinePresencePage = await context.newPage();
        await navigateToTargetPage(onlinePresencePage, "上班监控");
        await ensureLoginReadyForRun(onlinePresencePage);
        return onlinePresencePage;
      }, stopControl.state),
      monitorOffDutyWorkflow(async () => {
        const offDutyPage = await context.newPage();
        await navigateToTargetPage(offDutyPage, "下班监控");
        await ensureLoginReadyForRun(offDutyPage);
        return offDutyPage;
      }, stopControl.state)
    ]);
  } finally {
    stopRuntimeMaintenanceLoop();
    stopControl.dispose();
    await context.close();
    runRuntimeMaintenanceOnce({
      moduleName: "业务运行退出治理",
      browserDataDirs: collectBusinessBrowserDataDirs()
    });
  }
}

async function main() {
  // 这里统一编排主管端启动流程，上层只管调度，下层模块只管执行。
  resetCurrentLogFileOnce();
  const mode = resolveMode();
  log("主线:启动", "主程序", "解析模式", `当前启动模式：${mode}`);
  runBusinessRuntimeMaintenanceBeforeLaunch();

  if (mode === "login") {
    await runLoginMode();
    return;
  }

  await runHeadlessMode();
}

process.on("unhandledRejection", (error) => {
  throw error;
});

main().catch((error) => {
  logError("主线:失败", "主程序", "异常退出", error);
  process.exitCode = 1;
});
