// 该文件用于生成漏回复策略的不提醒结果。
function buildEmptyUnresolvedReplyDecision(reason, details = {}) {
  // 这里统一返回“不提醒”结构，让工作流不用猜字段是否存在。
  return {
    shouldRemind: false,
    reminderKind: "",
    reason,
    reasonLabel: reason,
    isPendingUnresolvedReplyCandidate: false,
    isPendingTimeoutReplyCandidate: false,
    isPendingMissedReplyCandidate: false,
    ...details
  };
}

module.exports = {
  buildEmptyUnresolvedReplyDecision
};
