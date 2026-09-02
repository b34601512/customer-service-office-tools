// 该文件用于决定未实质回复事件当前该发哪一段提醒。
const { normalizeThresholdSeconds, resolveMissedReplyThresholdSeconds } = require("./thresholds");

function buildUnresolvedReplyReminderDecision(unresolvedState, timeoutThresholdSeconds) {
  // 这里只决定当前未实质回复事件该发哪一段提醒：首次超时，或 10 倍阈值漏回复。
  const timeoutThreshold = normalizeThresholdSeconds(timeoutThresholdSeconds, "首次超时提醒阈值");
  const missedReplyThreshold = resolveMissedReplyThresholdSeconds(timeoutThreshold);
  if (!unresolvedState?.isPendingUnresolvedReplyCandidate) {
    return {
      ...unresolvedState,
      timeoutThresholdSeconds: timeoutThreshold,
      missedReplyThresholdSeconds: missedReplyThreshold,
      timeoutReminderTargetAtMs: 0,
      missedReplyReminderTargetAtMs: 0,
      shouldRemind: false,
      reminderKind: "",
      isPendingTimeoutReplyCandidate: false,
      isPendingMissedReplyCandidate: false
    };
  }

  const pendingSinceAtMs = Number(unresolvedState.pendingSinceAtMs || unresolvedState.lastCustomerMessageAtMs || 0);
  const pendingDurationSeconds = Number(unresolvedState.pendingDurationSeconds || 0);
  const timeoutReminderTargetAtMs = pendingSinceAtMs + timeoutThreshold * 1000;
  const missedReplyReminderTargetAtMs = pendingSinceAtMs + missedReplyThreshold * 1000;
  const shouldSkipTimeoutReminder = Boolean(unresolvedState.hasTemporaryReplyAfterCustomer);
  const baseDecision = {
    ...unresolvedState,
    timeoutThresholdSeconds: timeoutThreshold,
    missedReplyThresholdSeconds: missedReplyThreshold,
    timeoutReminderTargetAtMs,
    missedReplyReminderTargetAtMs,
    isPendingTimeoutReplyCandidate: !shouldSkipTimeoutReminder,
    isPendingMissedReplyCandidate: true
  };

  if (pendingDurationSeconds >= missedReplyThreshold) {
    return {
      ...baseDecision,
      shouldRemind: true,
      reminderKind: "missedReply",
      reason: unresolvedState.reasonLabel
    };
  }

  if (!shouldSkipTimeoutReminder && pendingDurationSeconds >= timeoutThreshold) {
    return {
      ...baseDecision,
      shouldRemind: true,
      reminderKind: "timeout",
      reason: unresolvedState.reasonLabel
    };
  }

  return {
    ...baseDecision,
    shouldRemind: false,
    reminderKind: shouldSkipTimeoutReminder ? "missedReply" : "timeout",
    reason: shouldSkipTimeoutReminder ? "已有人工临时回复，只等待漏回复提醒阈值" : "未达到首次超时提醒阈值"
  };
}

module.exports = {
  buildUnresolvedReplyReminderDecision
};
