// 该文件用于把磁盘漏回复状态统一迁移成当前稳定结构。
const { normalizeObjectMap } = require("./stateShape");
const { mergeLegacyReminderStore, normalizeReminderEventsByChatId } = require("./reminderEvent");
const { normalizeReminderSnapshotsByChatId } = require("./reminderSnapshot");

function normalizeMissedReplyMonitorState(state) {
  // 这里把磁盘状态压成稳定结构，并一次性迁移旧字段，项目里不再继续写旧池。
  const reminderEventsByChatId = normalizeReminderEventsByChatId(state?.reminderEventsByChatId);
  mergeLegacyReminderStore(reminderEventsByChatId, state?.timeoutRemindersByChatId, "timeout");
  mergeLegacyReminderStore(reminderEventsByChatId, state?.remindersByChatId, "missedReply");

  return {
    updatedAt: String(state?.updatedAt || ""),
    reminderEventsByChatId,
    reminderSnapshotsByChatId: normalizeReminderSnapshotsByChatId(state?.reminderSnapshotsByChatId),
    countdownItemsByChatId: normalizeObjectMap(state?.countdownItemsByChatId),
    decisionItemsByChatId: normalizeObjectMap(state?.decisionItemsByChatId)
  };
}

module.exports = {
  normalizeMissedReplyMonitorState
};
