// 该文件用于维护控制台未实质回复判定原因快照。
const { normalizeReminderKind } = require("./reminderKind");

function setUnresolvedReplyDecisionItem(runtimeState, item) {
  // 这里记录每个会话最近一次判定原因，方便现场核对“为什么提醒或为什么不提醒”。
  const chatId = String(item?.chatId || "").trim();
  if (!chatId) {
    return false;
  }
  if (!runtimeState.decisionItemsByChatId || typeof runtimeState.decisionItemsByChatId !== "object") {
    runtimeState.decisionItemsByChatId = {};
  }

  runtimeState.decisionItemsByChatId[chatId] = {
    chatId,
    customerName: String(item.customerName || "").trim(),
    assignedToUserId: String(item.assignedToUserId || "").trim(),
    assignmentStatus: String(item.assignmentStatus || "").trim(),
    assignmentStatusLabel: String(item.assignmentStatusLabel || "").trim(),
    contactListIndex: Number(item.contactListIndex || 0),
    previewText: String(item.previewText || ""),
    statusLabel: String(item.statusLabel || ""),
    decisionReason: String(item.decisionReason || ""),
    reasonLabel: String(item.reasonLabel || ""),
    latestMessageRole: String(item.latestMessageRole || ""),
    latestMessageSenderName: String(item.latestMessageSenderName || ""),
    latestMessageText: String(item.latestMessageText || ""),
    latestMessageAtMs: Number(item.latestMessageAtMs || 0),
    lastCustomerMessageAtMs: Number(item.lastCustomerMessageAtMs || 0),
    lastCustomerMessageText: String(item.lastCustomerMessageText || ""),
    pendingSinceAtMs: Number(item.pendingSinceAtMs || item.lastCustomerMessageAtMs || 0),
    recentAgentReplyText: String(item.recentAgentReplyText || ""),
    pendingDurationSeconds: Number(item.pendingDurationSeconds || 0),
    timeoutThresholdSeconds: Number(item.timeoutThresholdSeconds || 0),
    missedReplyThresholdSeconds: Number(item.missedReplyThresholdSeconds || 0),
    timeoutStatusLabel: String(item.timeoutStatusLabel || ""),
    timeoutDecisionReason: String(item.timeoutDecisionReason || ""),
    timeoutShouldRemind: Boolean(item.timeoutShouldRemind),
    isPendingTimeoutReplyCandidate: Boolean(item.isPendingTimeoutReplyCandidate),
    timeoutReminderTargetAtMs: Number(item.timeoutReminderTargetAtMs || 0),
    missedReplyStatusLabel: String(item.missedReplyStatusLabel || item.statusLabel || ""),
    missedReplyDecisionReason: String(item.missedReplyDecisionReason || item.decisionReason || ""),
    missedReplyShouldRemind: Boolean(item.missedReplyShouldRemind || item.shouldRemind),
    isPendingMissedReplyCandidate: Boolean(item.isPendingMissedReplyCandidate),
    missedReplyReminderTargetAtMs: Number(item.missedReplyReminderTargetAtMs || 0),
    nextReminderKind: normalizeReminderKind(item.nextReminderKind),
    nextReminderAtMs: Number(item.nextReminderAtMs || 0),
    scannedAtMs: Number(item.scannedAtMs || Date.now())
  };
  return true;
}

function clearUnresolvedReplyDecisionItem(runtimeState, chatId) {
  // 这里清掉已经离开联系人快照的判定记录，避免页面继续展示过期客户。
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId || !runtimeState.decisionItemsByChatId?.[normalizedChatId]) {
    return false;
  }

  delete runtimeState.decisionItemsByChatId[normalizedChatId];
  return true;
}

module.exports = {
  setUnresolvedReplyDecisionItem,
  clearUnresolvedReplyDecisionItem
};
