// 该文件用于把未实质回复判定结果转换成控制台倒计时和判定行。
const { hasReminderKindBeenSent } = require('../missedReplyStateStore');

function resolveReminderKindLabel(reminderKind) {
  // 这里统一把内部提醒类型翻译成终端和看板可读标签。
  return reminderKind === "timeout" ? "超时" : "漏回复";
}

function resolveTimeoutStatusLabel(decision) {
  // 这里只根据阈值判断首次超时状态，是否已经发送由状态池判断。
  if (!decision?.isPendingTimeoutReplyCandidate) {
    return "未进入超时";
  }
  if (Number(decision.pendingDurationSeconds || 0) >= Number(decision.timeoutThresholdSeconds || 0)) {
    return "超时已到点";
  }

  return "超时倒计时中";
}

function resolveMissedReplyStatusLabel(decision) {
  // 这里只根据 10 倍阈值判断漏回复状态，是否已经发送由状态池判断。
  if (!decision?.isPendingMissedReplyCandidate) {
    return "未进入漏回复";
  }
  if (Number(decision.pendingDurationSeconds || 0) >= Number(decision.missedReplyThresholdSeconds || 0)) {
    return "漏回复已到点";
  }

  return "漏回复倒计时中";
}

function resolveDecisionReason(decision) {
  // 这里给未到点和已到点两种情况输出明确原因，避免看板只显示空状态。
  if (!decision?.isPendingUnresolvedReplyCandidate) {
    return decision?.reason || decision?.reasonLabel || "未说明原因";
  }
  if (decision.shouldRemind) {
    return decision.reasonLabel || decision.reason || "未实质回复";
  }

  return decision.reason || "未达到首次超时提醒阈值";
}

function resolveNextReminderCountdown(decision, runtimeState) {
  // 这里决定页面下一段倒计时：未发首次就看首次，首次已发就看10倍漏回复，漏回复已发就不再倒计时。
  if (!decision?.isPendingUnresolvedReplyCandidate) {
    return null;
  }

  if (
    decision.isPendingTimeoutReplyCandidate &&
    !hasReminderKindBeenSent(runtimeState, decision, "timeout")
  ) {
    return {
      nextReminderKind: "timeout",
      nextReminderAtMs: Number(decision.timeoutReminderTargetAtMs || 0)
    };
  }

  if (!hasReminderKindBeenSent(runtimeState, decision, "missedReply")) {
    return {
      nextReminderKind: "missedReply",
      nextReminderAtMs: Number(decision.missedReplyReminderTargetAtMs || 0)
    };
  }

  return null;
}

function buildUnresolvedReplyCountdownItem(decision, runtimeState, nowMs) {
  // 这里把统一判定结果转成下一段提醒倒计时行，首页不关心消息分析细节。
  const nextReminder = resolveNextReminderCountdown(decision, runtimeState);
  if (!nextReminder) {
    return null;
  }

  return {
    chatId: decision.chatId,
    customerName: decision.customerName,
    assignedToUserId: decision.assignedToUserId,
    assignmentStatus: decision.assignmentStatus,
    assignmentStatusLabel: decision.assignmentStatusLabel,
    latestMessageRole: decision.latestMessageRole,
    latestMessageSenderName: decision.latestMessageSenderName,
    latestMessageText: decision.latestMessageText,
    latestMessageAtMs: decision.latestMessageAtMs,
    lastCustomerMessageAtMs: decision.lastCustomerMessageAtMs,
    lastCustomerMessageText: decision.lastCustomerMessageText,
    pendingSinceAtMs: decision.pendingSinceAtMs,
    recentAgentReplyText: decision.recentAgentReplyText,
    pendingDurationSeconds: decision.pendingDurationSeconds,
    nextReminderKind: nextReminder.nextReminderKind,
    nextReminderAtMs: nextReminder.nextReminderAtMs,
    timeoutReminderTargetAtMs: decision.timeoutReminderTargetAtMs,
    missedReplyReminderTargetAtMs: decision.missedReplyReminderTargetAtMs,
    reasonLabel: decision.reasonLabel,
    scannedAtMs: nowMs
  };
}

function buildUnifiedDecisionItem(input) {
  // 这里把一个客户的统一未实质回复判定压成控制台唯一判定行。
  const { unresolvedState, reminderDecision, contact, runtimeState, nowMs } = input;
  const chatId = String(unresolvedState?.chatId || contact?.chatId || "").trim();
  if (!chatId) {
    return null;
  }

  const countdownItem = buildUnresolvedReplyCountdownItem(reminderDecision, runtimeState, nowMs);
  return {
    chatId,
    customerName: String(unresolvedState?.customerName || contact?.customerName || "未识别客户").trim(),
    assignedToUserId: String(unresolvedState?.assignedToUserId || contact?.assignedToUserId || "").trim(),
    assignmentStatus: String(unresolvedState?.assignmentStatus || "").trim(),
    assignmentStatusLabel: String(unresolvedState?.assignmentStatusLabel || "").trim(),
    contactListIndex: Number(contact?.contactListIndex || 0),
    previewText: String(contact?.previewText || ""),
    statusLabel: resolveMissedReplyStatusLabel(reminderDecision),
    decisionReason: resolveDecisionReason(reminderDecision),
    reasonLabel: String(unresolvedState?.reasonLabel || unresolvedState?.reason || ""),
    latestMessageRole: String(unresolvedState?.latestMessageRole || ""),
    latestMessageSenderName: String(unresolvedState?.latestMessageSenderName || ""),
    latestMessageText: String(unresolvedState?.latestMessageText || ""),
    latestMessageAtMs: Number(unresolvedState?.latestMessageAtMs || 0),
    lastCustomerMessageAtMs: Number(unresolvedState?.lastCustomerMessageAtMs || 0),
    lastCustomerMessageText: String(unresolvedState?.lastCustomerMessageText || ""),
    pendingSinceAtMs: Number(unresolvedState?.pendingSinceAtMs || unresolvedState?.lastCustomerMessageAtMs || 0),
    recentAgentReplyText: String(unresolvedState?.recentAgentReplyText || ""),
    pendingDurationSeconds: Number(unresolvedState?.pendingDurationSeconds || 0),
    timeoutThresholdSeconds: Number(reminderDecision?.timeoutThresholdSeconds || 0),
    missedReplyThresholdSeconds: Number(reminderDecision?.missedReplyThresholdSeconds || 0),
    timeoutStatusLabel: resolveTimeoutStatusLabel(reminderDecision),
    timeoutDecisionReason: resolveDecisionReason(reminderDecision),
    timeoutShouldRemind: Boolean(
      reminderDecision?.isPendingTimeoutReplyCandidate &&
      Number(reminderDecision.pendingDurationSeconds || 0) >= Number(reminderDecision.timeoutThresholdSeconds || 0)
    ),
    isPendingTimeoutReplyCandidate: Boolean(reminderDecision?.isPendingTimeoutReplyCandidate),
    timeoutReminderTargetAtMs: Number(reminderDecision?.timeoutReminderTargetAtMs || 0),
    missedReplyStatusLabel: resolveMissedReplyStatusLabel(reminderDecision),
    missedReplyDecisionReason: resolveDecisionReason(reminderDecision),
    missedReplyShouldRemind: Boolean(
      reminderDecision?.isPendingMissedReplyCandidate &&
      Number(reminderDecision.pendingDurationSeconds || 0) >= Number(reminderDecision.missedReplyThresholdSeconds || 0)
    ),
    isPendingMissedReplyCandidate: Boolean(reminderDecision?.isPendingMissedReplyCandidate),
    missedReplyReminderTargetAtMs: Number(reminderDecision?.missedReplyReminderTargetAtMs || 0),
    nextReminderKind: String(countdownItem?.nextReminderKind || ""),
    nextReminderAtMs: Number(countdownItem?.nextReminderAtMs || 0),
    scannedAtMs: nowMs
  };
}

module.exports = {
  buildUnifiedDecisionItem,
  buildUnresolvedReplyCountdownItem,
  resolveDecisionReason,
  resolveMissedReplyStatusLabel,
  resolveReminderKindLabel,
  resolveTimeoutStatusLabel
};
