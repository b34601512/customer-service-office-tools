const path = require("path");
const { log } = require("../../engine/logger");
const { createSummaryEvidenceDir } = require("../summaryEvidenceDir");
const { buildEvidenceScopeName } = require("../../shared/evidenceNaming");
const {
  acquireSummarySource,
  findReusableSummarySourceRecord
} = require("./summarySourceAcquirer");
const { buildSummarySourceGroups } = require("./summarySourceGroups");
const { importStoreDataToSummary } = require("../../summaryData/summaryDataImporter");
const { notifyStoreProgress } = require("./summaryProgress");

function buildSummaryReportContexts(task, dateRange, buildResolvedConfig) {
  // 这个函数只解析一家店全部目标表的本轮运行配置。
  return task.reportKeys.map((reportKey) => ({
    reportKey,
    ...buildResolvedConfig({ platformKey: task.platformKey, storeKey: task.storeKey, reportKey, dateRange })
  }));
}

function mergeReusedEvidenceFiles(evidenceFiles, source) {
  // 这个函数只把复用记录里尚未展示的现存凭证加入本店结果。
  if (!source.reused) {
    return;
  }
  const knownEvidencePaths = new Set(evidenceFiles.map((item) => item.filePath));
  evidenceFiles.push(...source.evidenceFiles.filter((item) => !knownEvidencePaths.has(item.filePath)));
}

async function acquireStoreSummarySources(input) {
  // 这个函数只按来源分组顺序取得一家店需要的全部源文件。
  const sourceFiles = [];
  for (const [sourceGroupIndex, sourceGroup] of input.sourceGroups.entries()) {
    const source = await acquireSummarySource({
      ...input,
      sourceGroup,
      reusableRecord: input.reusableSourceRecords?.[sourceGroupIndex] || null,
      sourceFiles
    });
    sourceGroup.filePath = source.filePath;
    mergeReusedEvidenceFiles(input.evidenceFiles, source);
    sourceFiles.push({
      label: sourceGroup.label,
      filePath: source.filePath,
      reused: source.reused,
      alreadyImported: source.alreadyImported,
      reportKeys: sourceGroup.reportKeys
    });
  }
  return sourceFiles;
}

function resolveStoreSourceReuseRecords(input) {
  // 这个函数只在整店开始前确认每个来源是否已成功汇总。
  return input.sourceGroups.map((sourceGroup) => {
    const lookupInput = {
      ...input,
      sourceGroup
    };
    if (typeof input.onReuseDecision === "function") {
      lookupInput.onReuseDecision = (decision) => input.onReuseDecision(decision, sourceGroup);
    }
    return findReusableSummarySourceRecord(lookupInput);
  });
}

function resolveSummaryReuseNow(input) {
  // 这个函数只固定本轮复用检查使用的当前时间，避免多来源检查跨过自然日时口径不一致。
  const candidate = typeof input.nowFn === "function" ? input.nowFn() : input.now;
  const resolvedDate = candidate instanceof Date
    ? new Date(candidate.getTime())
    : new Date(candidate || Date.now());
  return Number.isFinite(resolvedDate.getTime()) ? resolvedDate : new Date();
}

function buildStoreSummaryResult(reportContexts, sourceFiles, evidenceFiles, importResult) {
  // 这个函数只生成一家店全部动作完成后的统一结果。
  const reusedCount = sourceFiles.filter((item) => item.reused).length;
  return {
    status: "success",
    action: "整店汇总完成",
    detail: `已写入 ${importResult.detailRows.length} 位客服数据，替换旧行 ${importResult.writeResult.removedCount} 条，复用 ${reusedCount} 份源表，新下载 ${sourceFiles.length - reusedCount} 份源表。`,
    downloadedPath: sourceFiles[0]?.filePath || "",
    sourceFiles,
    workbookPath: importResult.workbookPath,
    evidenceFiles,
    importResult
  };
}

function areAllStoreSourcesReusable(reusableSourceRecords) {
  // 这个函数只判断本店全部来源是否都已有今天可复用的源文件。
  return reusableSourceRecords.length > 0 && reusableSourceRecords.every((reusableRecord) => Boolean(reusableRecord?.filePath));
}

function shouldForceStoreSourceRedownload(reusableSourceRecords, forceRedownloadRequested = false) {
  // 这个函数只要本店有一个来源没有今天可复用文件，就要求本店全部来源重新下载。
  return forceRedownloadRequested || !areAllStoreSourcesReusable(reusableSourceRecords);
}

async function runStoreSummary(input) {
  // 这个函数只调度一家店的配置解析、源文件取得、逐表导入和结果返回。
  const { task, dateRange, projectConfig } = input;
  const reportContexts = buildSummaryReportContexts(task, dateRange, input.buildResolvedConfig);
  const evidenceFiles = [];
  const evidenceDir = createSummaryEvidenceDir({
    projectRoot: projectConfig.__projectRoot || path.resolve(__dirname, "..", "..", ".."),
    platformLabel: task.platformLabel,
    platformKey: task.platformKey,
    storeDisplayName: task.storeDisplayName,
    storeKey: task.storeKey
  });
  const evidenceFileNamePrefix = buildEvidenceScopeName(task);
  const sourceGroups = buildSummarySourceGroups(reportContexts, task, projectConfig);
  const forceRedownloadRequested = input.forceRedownload === true;
  const reusableSourceRecords = forceRedownloadRequested
    ? []
    : resolveStoreSourceReuseRecords({
        ...input,
        reportContexts,
        sourceGroups,
        now: resolveSummaryReuseNow(input),
        onReuseDecision(decision, sourceGroup) {
          log(
            "主线:判断",
            "批量汇总",
            "源文件复用检查",
            `店铺=${task.storeDisplayName}，来源=${sourceGroup.label}，${decision.reason}`
          );
        }
      });
  const forceStoreSourceRedownload = shouldForceStoreSourceRedownload(
    reusableSourceRecords,
    forceRedownloadRequested
  );
  if (forceStoreSourceRedownload) {
    log(
      "主线:判断",
      "批量汇总",
      "源文件取得",
      `店铺=${task.storeDisplayName}，${forceRedownloadRequested
        ? "用户选择[B]强制重新下载，本店全部来源重新下载。"
        : "至少一个来源不满足复用条件，本店全部来源重新下载。"}`
    );
  }
  const sourceFiles = await acquireStoreSummarySources({
    ...input,
    reportContexts,
    sourceGroups,
    reusableSourceRecords,
    forceRedownload: forceStoreSourceRedownload,
    evidenceFiles,
    evidenceDir,
    evidenceFileNamePrefix
  });
  // 新模型下每次都是全新一轮：即使源文件今天已下载可复用，也必须重新导入到本轮数据明细，不再整店跳过。
  const importResult = await importStoreDataToSummary({
    ...input,
    reportContexts,
    sourceGroups,
    sourceFiles,
    evidenceFiles,
    onProgress(action, detail) {
      notifyStoreProgress(task, input.onTaskProgress, {
        status: "running",
        action,
        detail,
        downloadedPath: sourceFiles[0]?.filePath || "",
        sourceFiles,
        evidenceFiles
      });
    }
  });
  return buildStoreSummaryResult(reportContexts, sourceFiles, evidenceFiles, importResult);
}

module.exports = {
  runStoreSummary,
  acquireStoreSummarySources,
  areAllStoreSourcesReusable,
  shouldForceStoreSourceRedownload,
  resolveStoreSourceReuseRecords
};
