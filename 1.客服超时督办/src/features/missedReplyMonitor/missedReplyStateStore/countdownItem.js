// 该文件用于维护控制台未实质回复倒计时快照。
const { normalizeReminderKind } = require("./reminderKind");

function setUnresolvedReplyCountdownItem(runtimeState, item) {
  // 这里把下一段提醒倒计时写入快照，页面只读快照不重新分析聊天记录。
  const chatId = String(item?.chatId || "").trim();
  if (!chatId) {
    return false;
  }
  if (!runtimeState.countdownItemsByChatId || typeof runtimeState.countdownItemsByChatId !== "object") {
    runtimeState.countdownItemsByChatId = {};
  }

  runtimeState.countdownItemsByChatId[chatId] = {
    chatId,
    customerName: String(item.customerName || "").trim(),
    assignedToUserId: String(item.assignedToUserId || "").trim(),
    assignmentStatus: String(item.assignmentStatus || "").trim(),
    assignmentStatusLabel: String(item.assignmentStatusLabel || "").trim(),
    latestMessageRole: String(item.latestMessageRole || ""),
    latestMessageSenderName: String(item.latestMessageSenderName || ""),
    latestMessageText: String(item.latestMessageText || ""),
    latestMessageAtMs: Number(item.latestMessageAtMs || 0),
    lastCustomerMessageAtMs: Number(item.lastCustomerMessageAtMs || 0),
    lastCustomerMessageText: String(item.lastCustomerMessageText || ""),
    pendingSinceAtMs: Number(item.pendingSinceAtMs || item.lastCustomerMessageAtMs || 0),
    recentAgentReplyText: String(item.recentAgentReplyText || ""),
    pendingDurationSeconds: Number(item.pendingDurationSeconds || 0),
    nextReminderKind: normalizeReminderKind(item.nextReminderKind),
    nextReminderAtMs: Number(item.nextReminderAtMs || 0),
    timeoutReminderTargetAtMs: Number(item.timeoutReminderTargetAtMs || 0),
    missedReplyReminderTargetAtMs: Number(item.missedReplyReminderTargetAtMs || 0),
    reasonLabel: String(item.reasonLabel || ""),
    scannedAtMs: Number(item.scannedAtMs || Date.now())
  };
  return true;
}

function clearUnresolvedReplyCountdownItem(runtimeState, chatId) {
  // 这里清掉已经解决或不再需要处理的倒计时快照，避免页面展示过期客户。
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId || !runtimeState.countdownItemsByChatId?.[normalizedChatId]) {
    return false;
  }

  delete runtimeState.countdownItemsByChatId[normalizedChatId];
  return true;
}

module.exports = {
  setUnresolvedReplyCountdownItem,
  clearUnresolvedReplyCountdownItem
};
