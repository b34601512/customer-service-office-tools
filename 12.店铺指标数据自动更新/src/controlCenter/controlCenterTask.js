const fs = require("fs");
const {
  readStoreMetricConfig,
  resolveConfiguredDateSelection,
  listEnabledStoreTasks
} = require("../config/storeMetricConfig");
const { collectAndWriteJdStoreMetrics } = require("../platforms/jd/storeMetrics/jdStoreMetricCollector");
const { collectAndWriteTmallStoreMetrics } = require("../platforms/tmall/storeMetrics/tmallStoreMetricCollector");
const { collectAndWritePddStoreMetrics } = require("../platforms/pdd/storeMetrics/pddStoreMetricCollector");
const { collectAndWriteDouyinStoreMetrics } = require("../platforms/douyin/storeMetrics/douyinStoreMetricCollector");
const { assertWorkbookAvailableForUpdate } = require("../summaryData/workbookUpdateGuard");
const {
  normalizeEvidenceFiles,
  listExistingEvidenceFiles,
  ensureStoreMetricFailureEvidence,
  ensureBatchFailureEvidence
} = require("../shared/evidenceFiles");
const {
  findSuccessfulStoreMetricRun,
  appendSuccessfulStoreMetricRun
} = require("../shared/taskHistoryParts/storeMetricRunHistory");
const { hasReusableStoreMetricData } = require("../summaryData/storeMetricWorkbookReader");
const {
  filterStoreTasksByCollectionScope,
  formatStoreCollectionScope
} = require("../shared/storeCollectionScope");

function serializeTaskError(error) {
  const evidenceFiles = listExistingEvidenceFiles(error?.evidenceFiles);
  return {
    message: String(error?.message || error),
    evidencePath: evidenceFiles[0]?.filePath || String(error?.evidencePath || ""),
    evidenceFiles
  };
}

function createPendingStoreResult(store) {
  return {
    platformKey: store.platformKey || "jd",
    storeKey: store.key,
    storeName: store.displayName,
    status: "ready",
    metricCount: 0,
    action: "等待开始",
    detail: "等待开始",
    evidencePath: "",
    evidenceFiles: [],
    skipped: false,
    updatedAt: ""
  };
}

function replaceStoreResult(storeResults, nextStoreResult) {
  return storeResults.map((storeResult) =>
    storeResult.platformKey === nextStoreResult.platformKey &&
    storeResult.storeKey === nextStoreResult.storeKey ? nextStoreResult : storeResult);
}

async function runSingleConfiguredStore({ config, store, dateSelection, collectStoreMetrics, onProgress }) {
  if (store.platformKey !== "douyin" && (!store.username || !store.password)) {
    throw new Error(`${store.displayName}账号或密码未配置。`);
  }
  return collectStoreMetrics({ config, store, dateSelection, onProgress });
}

function resolveStoreMetricCollector(store, dependencies) {
  if (typeof dependencies.collectStoreMetrics === "function") {
    return dependencies.collectStoreMetrics;
  }
  if (store.platformKey === "tmall") {
    return dependencies.collectTmallStoreMetrics || collectAndWriteTmallStoreMetrics;
  }
  if (store.platformKey === "pdd") {
    return dependencies.collectPddStoreMetrics || collectAndWritePddStoreMetrics;
  }
  if (store.platformKey === "douyin") {
    return dependencies.collectDouyinStoreMetrics || collectAndWriteDouyinStoreMetrics;
  }
  if (store.platformKey === "jd") {
    return dependencies.collectJdStoreMetrics || collectAndWriteJdStoreMetrics;
  }
  throw new Error(`暂不支持平台：${store.platformKey || "空"}。`);
}

function buildBatchResult(workbookPath, storeResults) {
  const collectedCount = storeResults.filter((storeResult) => storeResult.status === "success").length;
  const skippedCount = storeResults.filter((storeResult) => storeResult.status === "skipped").length;
  const successCount = collectedCount + skippedCount;
  const errorCount = storeResults.filter((storeResult) => storeResult.status === "error").length;
  return {
    workbookPath,
    metricCount: storeResults.reduce((total, storeResult) => total + Number(storeResult.metricCount || 0), 0),
    successCount,
    collectedCount,
    skippedCount,
    errorCount,
    totalStoreCount: storeResults.length,
    stores: storeResults
  };
}

async function runConfiguredStoresTask(stateStore, dependencies = {}) {
  const currentState = stateStore.read();
  if (currentState.status === "running") throw new Error("店铺正在批量汇总，请勿重复点击。");
  const readConfig = dependencies.readConfig || readStoreMetricConfig;
  const findSuccessfulRun = dependencies.findSuccessfulRun || findSuccessfulStoreMetricRun;
  const appendSuccessfulRun = dependencies.appendSuccessfulRun || appendSuccessfulStoreMetricRun;
  const checkReusableStoreData = dependencies.hasReusableStoreMetricData || hasReusableStoreMetricData;
  const assertWorkbookWritable = dependencies.assertWorkbookWritable || assertWorkbookAvailableForUpdate;
  const ensureStoreFailureEvidence = dependencies.ensureStoreFailureEvidence || ensureStoreMetricFailureEvidence;
  const ensureGlobalFailureEvidence = dependencies.ensureBatchFailureEvidence || ensureBatchFailureEvidence;
  const nowFn = dependencies.nowFn || (() => new Date());
  const forceRecollect = dependencies.forceRecollect === true;
  const collectionScope = dependencies.collectionScope;
  const taskStartedAt = nowFn();
  stateStore.update({
    status: "running",
    stage: "准备批量汇总",
    detail: `正在读取${formatStoreCollectionScope(collectionScope)}配置。`,
    startedAt: taskStartedAt.toISOString(),
    completedAt: "",
    activeStoreKey: "",
    storeResults: [],
    result: null,
    error: null
  });
  try {
    const config = readConfig();
    if (!fs.existsSync(config.workbook.path)) {
      throw new Error(`统一数据源不存在：${config.workbook.path}`);
    }
    assertWorkbookWritable(config.workbook.path);
    const enabledStores = filterStoreTasksByCollectionScope(
      listEnabledStoreTasks(config),
      collectionScope
    );
    if (!enabledStores.length) {
      throw new Error(`${formatStoreCollectionScope(collectionScope)}没有启用的店铺，请先在配置中启用至少一家店。`);
    }
    const dateSelection = resolveConfiguredDateSelection(config);
    let storeResults = enabledStores.map(createPendingStoreResult);
    stateStore.update({
      storeResults,
      detail: `本次范围：${formatStoreCollectionScope(collectionScope)}，共 ${enabledStores.length} 家店铺，按平台和店铺顺序逐家执行。`
    });
    for (let storeIndex = 0; storeIndex < enabledStores.length; storeIndex += 1) {
      const store = enabledStores[storeIndex];
      const reusableRun = forceRecollect ? null : findSuccessfulRun({
          store,
          dateSelection,
          workbookPath: config.workbook.path,
          now: taskStartedAt
        });
      if (reusableRun && await checkReusableStoreData({
        workbookPath: config.workbook.path,
        store,
        reusableRun
      })) {
        const skippedResult = {
          platformKey: store.platformKey || "jd",
          storeKey: store.key,
          storeName: store.displayName,
          status: "skipped",
          metricCount: 0,
          previousMetricCount: reusableRun.metricCount,
          action: "今日已完成，跳过",
          detail: `同店同口径今天已成功采集 ${reusableRun.metricCount} 项，本轮不登录、不读取、不重复写入。`,
          evidencePath: "",
          evidenceFiles: [],
          skipped: true,
          updatedAt: nowFn().toISOString()
        };
        storeResults = replaceStoreResult(storeResults, skippedResult);
        stateStore.update({
          activeStoreKey: "",
          stage: `${store.displayName}：今日已完成，跳过`,
          detail: skippedResult.detail,
          storeResults
        });
        continue;
      }
      const collectionReason = forceRecollect
        ? "本轮为强制重新采集，将覆盖同记录键数据并追加新记录。"
        : reusableRun
          ? "发现历史成功记录，但汇总表缺少完整数据，正在重新采集。"
          : "正在准备登录。";
      storeResults = replaceStoreResult(storeResults, {
        ...createPendingStoreResult(store),
        status: "running",
        action: "准备登录",
        detail: `进度 ${storeIndex + 1}/${enabledStores.length}，${collectionReason}`,
        updatedAt: nowFn().toISOString()
      });
      stateStore.update({
        activeStoreKey: store.key,
        stage: `正在汇总 ${store.displayName}`,
        detail: `进度 ${storeIndex + 1}/${enabledStores.length}，${collectionReason}`,
        storeResults
      });
      try {
        const storeTaskResult = await runSingleConfiguredStore({
          config,
          store,
          dateSelection,
          collectStoreMetrics: resolveStoreMetricCollector(store, dependencies),
          onProgress(progress) {
            const runningResult = {
              ...storeResults.find((storeResult) =>
                storeResult.platformKey === (store.platformKey || "jd") &&
                storeResult.storeKey === store.key),
              status: "running",
              action: progress.stage,
              detail: progress.detail,
              updatedAt: progress.at || nowFn().toISOString()
            };
            storeResults = replaceStoreResult(storeResults, runningResult);
            stateStore.update({
              stage: `${store.displayName}：${progress.stage}`,
              detail: progress.detail,
              storeResults
            });
          }
        });
        appendSuccessfulRun({
          store,
          dateSelection,
          workbookPath: config.workbook.path,
          metricCount: storeTaskResult.metricCount,
          recordKeys: storeTaskResult.recordKeys || (storeTaskResult.records || [])
            .map((record) => record.recordKey)
            .filter(Boolean),
          now: taskStartedAt,
          createdAt: nowFn().toISOString()
        });
        const skippedCount = (storeTaskResult.skippedMetrics || []).length;
        const successResult = {
          platformKey: store.platformKey || "jd",
          storeKey: store.key,
          storeName: store.displayName,
          status: "success",
          metricCount: storeTaskResult.metricCount,
          skippedCount,
          action: "汇总完成",
          detail: `已写入 ${storeTaskResult.metricCount} 条店铺指标${skippedCount ? `，跳过 ${skippedCount} 项未读取` : ""}。`,
          evidencePath: "",
          evidenceFiles: listExistingEvidenceFiles(storeTaskResult.evidenceFiles),
          skipped: false,
          updatedAt: nowFn().toISOString()
        };
        storeResults = replaceStoreResult(storeResults, successResult);
      } catch (error) {
        try {
          error.evidenceFiles = await Promise.resolve(ensureStoreFailureEvidence({ store, error }));
        } catch (_evidenceError) {
          error.evidenceFiles = normalizeEvidenceFiles(error?.evidenceFiles);
        }
        const serializedError = serializeTaskError(error);
        const failedResult = {
          platformKey: store.platformKey || "jd",
          storeKey: store.key,
          storeName: store.displayName,
          status: "error",
          metricCount: 0,
          action: "汇总失败",
          detail: serializedError.message,
          evidencePath: serializedError.evidencePath,
          evidenceFiles: serializedError.evidenceFiles,
          skipped: false,
          updatedAt: nowFn().toISOString()
        };
        storeResults = replaceStoreResult(storeResults, failedResult);
      }
      stateStore.update({ storeResults });
    }
    const batchResult = buildBatchResult(config.workbook.path, storeResults);
    const finalStatus = batchResult.errorCount === 0
      ? "success"
      : batchResult.successCount > 0 ? "partial_error" : "error";
    stateStore.update({
      status: finalStatus,
      stage: "批量汇总完成",
      detail: `新采集 ${batchResult.collectedCount} 家，今日跳过 ${batchResult.skippedCount} 家，失败 ${batchResult.errorCount} 家。`,
      completedAt: nowFn().toISOString(),
      activeStoreKey: "",
      storeResults,
      result: batchResult,
      error: null
    });
    return batchResult;
  } catch (error) {
    try {
      error.evidenceFiles = await Promise.resolve(ensureGlobalFailureEvidence(error));
    } catch (_evidenceError) {
      error.evidenceFiles = normalizeEvidenceFiles(error?.evidenceFiles);
    }
    stateStore.update({
      status: "error",
      stage: "批量汇总失败",
      detail: String(error?.message || error),
      completedAt: nowFn().toISOString(),
      activeStoreKey: "",
      error: serializeTaskError(error)
    });
    throw error;
  }
}

module.exports = {
  serializeTaskError,
  createPendingStoreResult,
  replaceStoreResult,
  buildBatchResult,
  runSingleConfiguredStore,
  resolveStoreMetricCollector,
  runConfiguredStoresTask
};
