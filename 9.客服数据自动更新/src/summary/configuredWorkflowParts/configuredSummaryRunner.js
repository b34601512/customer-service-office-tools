const { log, logError } = require("../../engine/logger");
const { readProjectConfig } = require("../../config/projectConfigServiceParts/projectConfigPersistence");
const { buildConfiguredSummaryTasks } = require("../../controlCenter/summaryTaskPlanner");
const { isApplicationShutdownRequested } = require("../../shared/applicationShutdownSignal");
const { resolveDefaultSummaryDateRange } = require("../summaryDateRange");
const { closeManagedChrome } = require("../../engine/chromeSession");
const { assertSummaryWorkbookWritable } = require("../../summaryData/summaryWorkbookAvailability");
const { resetSummaryRunForToday } = require("./summaryRunReset");
const { notifySummaryTaskProgress } = require("./summaryTaskProgress");
const { runSingleSummaryTask } = require("./summaryTaskRuntime");
const {
  ensureSummaryErrorEvidence,
  writeSummaryEvidenceCaptureFailure
} = require("./summaryFailureEvidence");

function buildSuccessfulSummaryTask(task, taskResult) {
  // 这个函数只把一家店的执行结果转换成成功任务状态。
  return {
    ...task,
    ...taskResult,
    id: task.id,
    status: "success",
    updatedAt: new Date().toISOString()
  };
}

function buildFailedSummaryTask(task, error, evidenceFiles) {
  // 这个函数只把一家店的错误转换成失败任务状态。
  return {
    ...task,
    status: "error",
    action: "汇总失败",
    detail: error instanceof Error ? error.message : String(error),
    evidenceFiles,
    updatedAt: new Date().toISOString()
  };
}

async function resolveFailedTaskEvidence(task, error, projectRoot, logErrorFn) {
  // 这个函数只在逐店异常边界采集凭证并完整记录凭证故障。
  try {
    return await ensureSummaryErrorEvidence(task, error, projectRoot);
  } catch (evidenceError) {
    logErrorFn("主线:失败", "批量汇总", "采集失败凭证", evidenceError);
    return writeSummaryEvidenceCaptureFailure(task, error, evidenceError, projectRoot);
  }
}

function buildConfiguredSummaryResult(results) {
  // 这个函数只汇总本轮已执行店铺的成功与失败数量。
  const errorCount = results.filter((task) => task.status === "error").length;
  const successCount = results.length - errorCount;
  return {
    status: errorCount ? "partial_error" : "success",
    successCount,
    errorCount,
    totalCount: results.length,
    tasks: results,
    detail: errorCount
      ? `本次汇总完成：成功 ${successCount} 家，失败 ${errorCount} 家。`
      : `本次汇总全部完成：共 ${successCount} 家。`
  };
}

async function closeFinalSummaryStoreBrowser(options, logFn, logErrorFn) {
  // 这个函数只负责整轮汇总结束后的最后一个受控店铺浏览器收尾，失败不覆盖业务结果。
  const closeManagedChromeFn = options.closeManagedChrome || closeManagedChrome;
  try {
    await closeManagedChromeFn();
    logFn("主线:完成", "批量汇总", "关闭最后店铺窗口", "整轮汇总已结束，最后一个受控店铺浏览器已关闭");
    return true;
  } catch (error) {
    logErrorFn("主线:失败", "批量汇总", "关闭最后店铺窗口", error);
    return false;
  }
}

async function runConfiguredSummaryWorkflow(options = {}) {
  // 这个函数只逐店调度，并在唯一外层异常边界记录失败后继续下一店。
  const projectConfig = options.projectConfig || readProjectConfig();
  const dateRange = options.dateRange || resolveDefaultSummaryDateRange(new Date());
  const tasks = options.tasks || buildConfiguredSummaryTasks(projectConfig);
  const logFn = options.logFn || log;
  const logErrorFn = options.logErrorFn || logError;
  const runTask = options.runSingleSummaryTask || runSingleSummaryTask;
  const results = [];
  if (!tasks.length) {
    throw new Error("本次汇总清单为空，请先在配置里启用需要汇总的目标表。");
  }
  const assertWorkbookWritable = options.assertSummaryWorkbookWritable || assertSummaryWorkbookWritable;
  logFn("主线:执行", "批量汇总", "汇总表预检", `准备确认汇总表可写：${projectConfig.workbook?.path || "未配置"}`);
  await assertWorkbookWritable(projectConfig.workbook?.path);
  logFn("主线:完成", "批量汇总", "汇总表预检", "汇总表可独占读写，开始执行店铺清单");
  // 仅"开始全部汇总"（本轮全新一轮）执行重置：清空数据明细、重置历史、清理今天以前源文件。
  // 单店重跑不经过此重置，只复用今天文件重写该店。
  if (options.resetForToday !== false) {
    await resetSummaryRunForToday({ projectConfig, now: options.now || new Date() });
  }
  try {
    for (const task of tasks) {
      if (isApplicationShutdownRequested()) {
        break;
      }
      notifySummaryTaskProgress(task, options.onTaskProgress, {
        status: "running",
        action: "开始汇总",
        detail: `正在完成「${task.storeDisplayName}」整本汇总表。`
      });
      try {
        logFn("主线:执行", "批量汇总", "处理店铺", `平台=${task.platformLabel}，店铺=${task.storeDisplayName}，目标表=${task.reportKeys?.length || 1}张`);
        const taskDateRange = resolveTaskDateRange(task, dateRange);
        const taskResult = await runTask({
          task,
          dateRange: taskDateRange,
          forceRedownload: options.forceRedownload === true,
          onTaskProgress: options.onTaskProgress
        });
        const successTask = buildSuccessfulSummaryTask(task, taskResult);
        results.push(successTask);
        notifySummaryTaskProgress(task, options.onTaskProgress, successTask);
      } catch (error) {
        const evidenceFiles = await resolveFailedTaskEvidence(task, error, projectConfig.__projectRoot, logErrorFn);
        const failedTask = buildFailedSummaryTask(task, error, evidenceFiles);
        results.push(failedTask);
        notifySummaryTaskProgress(task, options.onTaskProgress, failedTask);
        logErrorFn("主线:失败", "批量汇总", "处理店铺", error);
      }
    }
    return buildConfiguredSummaryResult(results);
  } finally {
    await closeFinalSummaryStoreBrowser(options, logFn, logErrorFn);
  }
}

function resolveTaskDateRange(task, fallbackDateRange) {
  // 每家店优先使用配置清单中的真实日期，确保单店自定义日期不会被全局范围覆盖。
  const startText = String(task?.exportDateRangeStartText || "").trim();
  const endText = String(task?.exportDateRangeEndText || "").trim();
  if (!startText || !endText) return fallbackDateRange;
  return {
    ...fallbackDateRange,
    startText,
    endText,
    start: { type: "custom_date", offsetDays: 0, customDate: startText },
    end: { type: "custom_date", offsetDays: 0, customDate: endText },
    mode: task?.usesGlobalExportDateRange === false ? "store_manual" : "configured"
  };
}

module.exports = {
  runConfiguredSummaryWorkflow,
  closeFinalSummaryStoreBrowser,
  resolveTaskDateRange
};
