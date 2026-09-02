// 该文件用于管理未实质回复监控运行态的创建和落盘。
const {
  buildEmptyMissedReplyMonitorState,
  readMissedReplyMonitorState,
  writeMissedReplyMonitorState
} = require('../missedReplyStateStore');

function createMissedReplyMonitorRuntimeState() {
  // 这里统一初始化未实质回复监控运行态，只保留一份提醒事件池，避免短长两套状态互相打架。
  const persistedState = readMissedReplyMonitorState();
  const initialState = persistedState && typeof persistedState === "object"
    ? persistedState
    : buildEmptyMissedReplyMonitorState();
  return {
    reminderEventsByChatId:
      initialState.reminderEventsByChatId && typeof initialState.reminderEventsByChatId === "object"
        ? initialState.reminderEventsByChatId
        : {},
    reminderSnapshotsByChatId:
      initialState.reminderSnapshotsByChatId && typeof initialState.reminderSnapshotsByChatId === "object"
        ? initialState.reminderSnapshotsByChatId
        : {},
    countdownItemsByChatId:
      initialState.countdownItemsByChatId && typeof initialState.countdownItemsByChatId === "object"
        ? initialState.countdownItemsByChatId
        : {},
    decisionItemsByChatId:
      initialState.decisionItemsByChatId && typeof initialState.decisionItemsByChatId === "object"
        ? initialState.decisionItemsByChatId
        : {},
    nextContactStartIndex: 0,
    lastSummaryKey: "",
    disabledLogged: false
  };
}

function persistMissedReplyRuntimeState(runtimeState) {
  // 这里把循环提醒进度写回磁盘，落盘时也只写新结构。
  writeMissedReplyMonitorState({
    reminderEventsByChatId: runtimeState.reminderEventsByChatId,
    reminderSnapshotsByChatId: runtimeState.reminderSnapshotsByChatId,
    countdownItemsByChatId: runtimeState.countdownItemsByChatId,
    decisionItemsByChatId: runtimeState.decisionItemsByChatId
  });
}

module.exports = {
  createMissedReplyMonitorRuntimeState,
  persistMissedReplyRuntimeState
};
