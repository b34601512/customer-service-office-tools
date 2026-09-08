const { downloadTmallReport } = require("../../platforms/tmall/downloadTaskParts/tmallDownloadRunner");
const { downloadJdReport } = require("../../platforms/jd/jdDownloadTask");
const { downloadPddReport } = require("../../platforms/pdd/downloadTaskParts/pddDownloadRunner");
const { downloadDouyinReport } = require("../../platforms/douyin/downloadTaskParts/douyinReportDownloader");
const { ensureTmallSummaryWindow } = require("../tmallSummaryWindow");
const { notifyStoreProgress } = require("./summaryProgress");
const { readManagedChromeSession } = require("../../engine/chromeSession");
const { runManagedOpenWindowEngine } = require("../../shared/managedOpenWindowEngine");
const { startJdLoginAssist } = require("../../platforms/jd/jdLoginAssist");
const { startPddLoginAssist } = require("../../platforms/pdd/pddLoginAssist");
const { runHybridSourceDownload } = require("./hybridSourceRunner");

const defaultDownloadFunctionByPlatform = {
  tmall: downloadTmallReport,
  jd: downloadJdReport,
  pdd: downloadPddReport,
  douyin: downloadDouyinReport
};

async function ensureSummarySourceBrowser({ task, sourceGroup, onTaskProgress, evidenceFiles, ensurePlatformWindow }) {
  // 这个函数只在新下载前准备当前店铺浏览器，复用源文件不会调用它。
  const representative = sourceGroup.contexts[0].resolvedConfig;
  if (task.platformKey === "tmall") {
    await ensureTmallSummaryWindow({
      store: representative.activeStore,
      evidenceFiles,
      onProgress(progress) {
        notifyStoreProgress(task, onTaskProgress, progress);
      }
    });
    return;
  }
  await ensurePlatformWindow({ task, resolvedConfig: representative, onTaskProgress });
}

function buildSourceDownloadConfig(sourceGroup) {
  // 这个函数只把一组同源目标表整理成一次下载需要的运行配置。
  const representative = sourceGroup.contexts[0].resolvedConfig;
  return {
    ...representative,
    reportKey: sourceGroup.downloadReportKey,
    sourceReportKeys: sourceGroup.reportKeys,
    activeStore: {
      ...representative.activeStore,
      activeReportKey: sourceGroup.downloadReportKey,
      downloadRequiredMetricMappings: sourceGroup.contexts
        .flatMap((context) => context.resolvedConfig.activeStore.metricMappings || [])
    }
  };
}

async function downloadSummarySource(input) {
  // 这个函数只下载一个已经去重的真实数据源。
  const {
    task,
    sourceGroup,
    dateRange,
    evidenceDir,
    evidenceFiles,
    evidenceFileNamePrefix,
    onTaskProgress,
    ensurePlatformWindow
  } = input;
  const downloadFn = input.downloadFunctionByPlatform?.[task.platformKey] || defaultDownloadFunctionByPlatform[task.platformKey];
  if (!downloadFn) {
    throw new Error(`暂不支持该平台下载：${task.platformKey}`);
  }
  await ensureSummarySourceBrowser({ task, sourceGroup, onTaskProgress, evidenceFiles, ensurePlatformWindow });
  const resolvedConfig = buildSourceDownloadConfig(sourceGroup);
  const reportProgress = (stageText, detail = "") => {
      notifyStoreProgress(task, onTaskProgress, {
        status: "running",
        action: `下载：${stageText}`,
        detail,
        evidenceFiles
      });
    };
  const session = readManagedChromeSession();
  const ownsSession = session?.platformKey === task.platformKey && session?.storeKey === resolvedConfig.activeStore.key;
  const startAssist = task.platformKey === "jd" ? startJdLoginAssist : task.platformKey === "pdd" ? startPddLoginAssist : null;
  return runHybridSourceDownload({
    platformKey: task.platformKey,
    headless: ownsSession && session.headless === true,
    onProgress: reportProgress,
    async openHeaded() {
      await runManagedOpenWindowEngine({
        platformKey: task.platformKey, storeConfig: resolvedConfig.activeStore,
        browserMode: "headed", preserveCache: true,
        actionName: "人工验证切换可见浏览器", moduleName: "批量汇总",
        startAssist: startAssist ? ({ forceRestart }) => startAssist({ forceRestart, reportKey: resolvedConfig.reportKey, resolvedConfig }) : null
      });
    }
  }, () => downloadFn(reportProgress, {
      reportKey: sourceGroup.downloadReportKey,
      resolvedConfig,
      exportRange: dateRange,
      evidenceDir,
      evidenceFiles,
      evidenceFileNamePrefix,
      sourceReportKeys: sourceGroup.reportKeys
    })
  );
}

module.exports = {
  downloadSummarySource
};
