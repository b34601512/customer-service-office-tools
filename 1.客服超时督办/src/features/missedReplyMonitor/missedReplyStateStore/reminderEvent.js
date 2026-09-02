// 该文件用于维护同一客户消息的两段提醒事件。
const { normalizeObjectMap } = require("./stateShape");

function normalizeReminderEvent(event) {
  // 这里保留同一待回复责任的两段提醒记录，客户追问不产生新事件。
  return {
    customerName: String(event?.customerName || "").trim(),
    lastCustomerMessageAtMs: Number(event?.lastCustomerMessageAtMs || 0),
    pendingSinceAtMs: Number(event?.pendingSinceAtMs || event?.lastCustomerMessageAtMs || 0),
    timeoutReminderSentAtMs: Number(event?.timeoutReminderSentAtMs || 0),
    missedReplyReminderSentAtMs: Number(event?.missedReplyReminderSentAtMs || 0),
    lastReminderAtMs: Number(event?.lastReminderAtMs || 0)
  };
}

function normalizeReminderEventsByChatId(eventsByChatId) {
  // 这里统一清洗新事件池，只保留 chatId 和有效提醒事件。
  return Object.fromEntries(
    Object.entries(normalizeObjectMap(eventsByChatId))
      .map(([chatId, event]) => [String(chatId || "").trim(), normalizeReminderEvent(event)])
      .filter(([chatId, event]) => chatId && event.pendingSinceAtMs > 0)
  );
}

function mergeLegacyReminderStore(targetEventsByChatId, legacyStore, reminderKind) {
  // 这里把旧的“轮次提醒池”迁移成新事件池，避免升级后同一条消息重复提醒。
  for (const [chatId, legacyEvent] of Object.entries(normalizeObjectMap(legacyStore))) {
    const normalizedChatId = String(chatId || "").trim();
    const lastCustomerMessageAtMs = Number(legacyEvent?.lastCustomerMessageAtMs || 0);
    if (!normalizedChatId || lastCustomerMessageAtMs <= 0) {
      continue;
    }

    const existingEvent = targetEventsByChatId[normalizedChatId] || {};
    const lastReminderAtMs = Number(legacyEvent?.lastReminderAtMs || 0);
    targetEventsByChatId[normalizedChatId] = normalizeReminderEvent({
      ...existingEvent,
      customerName: existingEvent.customerName || legacyEvent.customerName,
      lastCustomerMessageAtMs,
      pendingSinceAtMs: Number(legacyEvent?.pendingSinceAtMs || lastCustomerMessageAtMs),
      timeoutReminderSentAtMs:
        reminderKind === "timeout" ? lastReminderAtMs : existingEvent.timeoutReminderSentAtMs,
      missedReplyReminderSentAtMs:
        reminderKind === "missedReply" ? lastReminderAtMs : existingEvent.missedReplyReminderSentAtMs,
      lastReminderAtMs: Math.max(Number(existingEvent.lastReminderAtMs || 0), lastReminderAtMs)
    });
  }
}

module.exports = {
  normalizeReminderEvent,
  normalizeReminderEventsByChatId,
  mergeLegacyReminderStore
};
