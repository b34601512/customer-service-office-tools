// 该文件用于识别同一段待回复责任。
function buildCandidateEventIdentity(candidate) {
  // 责任身份只取首条未解决消息；客户追问只更新内容，不能重开提醒或重置计时。
  return {
    chatId: String(candidate?.chatId || "").trim(),
    customerName: String(candidate?.customerName || "").trim(),
    lastCustomerMessageAtMs: Number(candidate?.lastCustomerMessageAtMs || 0),
    pendingSinceAtMs: Number(candidate?.pendingSinceAtMs || candidate?.lastCustomerMessageAtMs || 0)
  };
}

function isSameReminderEvent(existingEvent, candidate) {
  // 人工实质回复后的新责任会有新起点；同一责任内的追问仍视为同一事件。
  const identity = buildCandidateEventIdentity(candidate);
  return Number(existingEvent?.pendingSinceAtMs || 0) === identity.pendingSinceAtMs;
}

function getReminderEvent(runtimeState, candidate) {
  // 这里按 chatId 取提醒事件，让工作流和控制台共用同一份状态。
  const chatId = String(candidate?.chatId || "").trim();
  return chatId ? runtimeState?.reminderEventsByChatId?.[chatId] || null : null;
}

module.exports = {
  buildCandidateEventIdentity,
  isSameReminderEvent,
  getReminderEvent
};
