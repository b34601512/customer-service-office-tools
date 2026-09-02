// 该文件用于维护漏回复状态的空结构和对象池清洗。
function buildEmptyMissedReplyMonitorState() {
  return {
    updatedAt: "",
    reminderEventsByChatId: {},
    reminderSnapshotsByChatId: {},
    countdownItemsByChatId: {},
    decisionItemsByChatId: {}
  };
}

function normalizeObjectMap(value) {
  // 这里把状态里的对象池统一收口，坏字段直接丢弃，避免污染本轮判断。
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

module.exports = {
  buildEmptyMissedReplyMonitorState,
  normalizeObjectMap
};
