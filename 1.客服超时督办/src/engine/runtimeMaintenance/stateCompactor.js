const appConfig = require("../../config/appConfig");
const { pruneObjectMapByAgeAndCount } = require("./objectMapPruner");
const { readJsonFileIfExists, writeJsonStateFile } = require("./jsonStateFile");

function buildStatePruneOptions(options = {}) {
  // 该函数把运行维护配置收口成裁剪参数，避免每个状态文件各自计算阈值。
  const retentionDays = Number(options.retentionDays ?? appConfig.runtimeMaintenanceStateRetentionDays);
  return {
    nowMs: Number(options.nowMs || Date.now()),
    retentionMs: Math.max(0, retentionDays) * 24 * 60 * 60 * 1000,
    maxEntries: Math.max(1, Number(options.maxEntries || appConfig.runtimeMaintenanceMaxStateEntries || 800))
  };
}

function applyPrunedObjectField(state, fieldName, pruneOptions) {
  // 该函数裁剪状态里的单个对象池，并返回被移除的条目数。
  const result = pruneObjectMapByAgeAndCount(state[fieldName], pruneOptions);
  state[fieldName] = result.objectMap;
  return result.removedCount;
}

function compactMissedReplyState(state, options = {}) {
  // 该函数裁剪漏回复运行状态，只处理可重建的历史事件和页面快照池。
  const pruneOptions = buildStatePruneOptions(options);
  let removedCount = 0;
  const compactedState = { ...state };
  for (const fieldName of [
    "reminderEventsByChatId",
    "reminderSnapshotsByChatId",
    "countdownItemsByChatId",
    "decisionItemsByChatId"
  ]) {
    removedCount += applyPrunedObjectField(compactedState, fieldName, pruneOptions);
  }
  return { state: compactedState, removedCount };
}

function compactTransferState(state, options = {}) {
  // 该函数裁剪转接快照基线，防止历史客户永远留在比较池里。
  const compactedState = { ...state };
  const removedCount = applyPrunedObjectField(
    compactedState,
    "contactsByChatId",
    buildStatePruneOptions(options)
  );
  return { state: compactedState, removedCount };
}

function compactOnlinePresenceState(state, options = {}) {
  // 该函数裁剪无人在线历史提醒，同时保留当前正在持续的无人在线段。
  const compactedState = { ...state };
  const pruneOptions = {
    ...buildStatePruneOptions(options),
    alwaysKeepKeys: [String(state?.activeAbsenceKey || "")]
  };
  const removedCount = applyPrunedObjectField(compactedState, "remindersByAbsenceKey", pruneOptions);
  return { state: compactedState, removedCount };
}

function compactOffDutyState(state, options = {}) {
  // 该函数裁剪下班监控历史动作和历史通知，避免每天累积的完成状态无限增长。
  const compactedState = { ...state };
  const pruneOptions = buildStatePruneOptions(options);
  const removedCount =
    applyPrunedObjectField(compactedState, "completedActions", pruneOptions) +
    applyPrunedObjectField(compactedState, "completionNotices", pruneOptions);
  return { state: compactedState, removedCount };
}

function compactStateFile(filePath, compactState, options = {}) {
  // 该函数处理一个状态文件：不存在就跳过，存在就裁剪并在有变化时写回。
  const state = readJsonFileIfExists(filePath);
  if (!state) {
    return { filePath, changed: false, removedCount: 0 };
  }

  const result = compactState(state, options);
  if (result.removedCount > 0) {
    writeJsonStateFile(filePath, result.state);
  }

  return {
    filePath,
    changed: result.removedCount > 0,
    removedCount: result.removedCount
  };
}

function compactRuntimeStateFiles(options = {}) {
  // 该函数统一治理所有运行状态快照，业务模块只负责写状态，不再各自处理膨胀。
  const stateFiles = [
    { filePath: appConfig.missedReplyMonitorStatePath, compactState: compactMissedReplyState },
    { filePath: appConfig.transferMonitorStatePath, compactState: compactTransferState },
    { filePath: appConfig.onlinePresenceStatePath, compactState: compactOnlinePresenceState },
    { filePath: appConfig.offDutyStatePath, compactState: compactOffDutyState }
  ];
  const fileResults = stateFiles.map((item) => compactStateFile(item.filePath, item.compactState, options));
  return {
    fileResults,
    removedCount: fileResults.reduce((total, item) => total + item.removedCount, 0),
    changedFileCount: fileResults.filter((item) => item.changed).length
  };
}

module.exports = {
  compactMissedReplyState,
  compactOffDutyState,
  compactOnlinePresenceState,
  compactRuntimeStateFiles,
  compactStateFile,
  compactTransferState
};
