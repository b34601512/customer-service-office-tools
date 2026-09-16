// 该文件登记「已发出转接指令、等下一轮联系人快照确认结果」的自动转接，避免把"指令发出去了"当成"真的转成功了"。
const DEFAULT_TRANSFER_VERIFY_TIMEOUT_MS = 30000;

let pendingVerifications = [];

function normalizePendingEntry(entry, nowMs) {
  return {
    chatId: String(entry.chatId || "").trim(),
    customerName: String(entry.customerName || "").trim(),
    sourceStaffName: String(entry.sourceStaffName || "").trim(),
    sourceStaffGroup: String(entry.sourceStaffGroup || "").trim(),
    targetStaffName: String(entry.targetStaffName || "").trim(),
    targetUserId: String(entry.targetUserId || "").trim(),
    targetStaffGroup: String(entry.targetStaffGroup || "").trim(),
    reminderKind: String(entry.reminderKind || "").trim(),
    socketIndex: Number.isInteger(entry.socketIndex) ? entry.socketIndex : -1,
    recordAtMs: nowMs,
    deadlineMs: nowMs + Math.max(5000, Number(entry.timeoutMs) || DEFAULT_TRANSFER_VERIFY_TIMEOUT_MS)
  };
}

function recordPendingTransferVerification(entry = {}) {
  // 同一个客户只保留最新一条待核验记录，避免同一会话重复堆积。
  const nowMs = Date.now();
  const next = normalizePendingEntry(entry, nowMs);
  pendingVerifications = pendingVerifications.filter((item) => item.chatId !== next.chatId);
  pendingVerifications.push(next);
  return next;
}

function listPendingTransferVerifications() {
  return pendingVerifications.slice();
}

function resetPendingTransferVerifications() {
  // 仅测试与排查使用。
  pendingVerifications = [];
}

function findContactByChatId(contacts, chatId) {
  const normalizedChatId = String(chatId || "").trim();
  return (Array.isArray(contacts) ? contacts : []).find(
    (contact) => String(contact?.chatId || "").trim() === normalizedChatId
  ) || null;
}

function settlePendingTransferVerifications(contacts, options = {}) {
  // 联系人快照是唯一事实：只有平台把它改成目标客服，才算真的转接成功。
  const nowMs = Number(options.nowMs) || Date.now();
  const verified = [];
  const failed = [];
  const waiting = [];

  for (const pending of pendingVerifications) {
    const contact = findContactByChatId(contacts, pending.chatId);
    const assignedToUserId = String(contact?.assignedToUserId || "").trim();
    if (contact && assignedToUserId === pending.targetUserId) {
      verified.push({ ...pending, assignedToUserId, elapsedMs: nowMs - pending.recordAtMs });
      continue;
    }

    if (nowMs < pending.deadlineMs) {
      waiting.push({ ...pending, assignedToUserId, contactSeen: Boolean(contact) });
      continue;
    }

    failed.push({
      ...pending,
      assignedToUserId,
      contactSeen: Boolean(contact),
      elapsedMs: nowMs - pending.recordAtMs,
      reason: !contact
        ? "chat_not_found_in_snapshot"
        : (assignedToUserId ? "assignment_unchanged" : "assignment_still_empty")
    });
  }

  pendingVerifications = waiting;

  return { verified, failed, waiting };
}

module.exports = {
  DEFAULT_TRANSFER_VERIFY_TIMEOUT_MS,
  listPendingTransferVerifications,
  recordPendingTransferVerification,
  resetPendingTransferVerifications,
  settlePendingTransferVerifications
};
