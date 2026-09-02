// 该文件用于判断和标记未实质回复提醒是否已经发送。
const { normalizeReminderKind } = require("./reminderKind");
const { normalizeReminderEvent } = require("./reminderEvent");
const {
  buildCandidateEventIdentity,
  getReminderEvent,
  isSameReminderEvent
} = require("./reminderIdentity");

function hasReminderKindBeenSent(runtimeState, candidate, reminderKind = candidate?.reminderKind) {
  // 这里判断同一待回复责任的某一段提醒是否已经发过。
  const normalizedKind = normalizeReminderKind(reminderKind);
  const existingEvent = getReminderEvent(runtimeState, candidate);
  if (!normalizedKind || !existingEvent || !isSameReminderEvent(existingEvent, candidate)) {
    return false;
  }

  return normalizedKind === "timeout"
    ? Number(existingEvent.timeoutReminderSentAtMs || 0) > 0
    : Number(existingEvent.missedReplyReminderSentAtMs || 0) > 0;
}

function shouldSendUnresolvedReplyReminder(runtimeState, candidate) {
  // 这里只允许同一待回复责任触发两段提醒：首次超时一次，10倍阈值漏回复一次。
  const identity = buildCandidateEventIdentity(candidate);
  const reminderKind = normalizeReminderKind(candidate?.reminderKind);
  if (!identity.chatId || !reminderKind || identity.pendingSinceAtMs <= 0) {
    return false;
  }

  return !hasReminderKindBeenSent(runtimeState, candidate, reminderKind);
}

function markUnresolvedReplyReminderSent(runtimeState, candidate, nowMs = Date.now()) {
  // 这里推进当前事件的对应提醒段，保留另一段状态，避免两段互相覆盖。
  const identity = buildCandidateEventIdentity(candidate);
  const reminderKind = normalizeReminderKind(candidate?.reminderKind);
  if (!identity.chatId) {
    throw new Error("未实质回复提醒状态写入失败：chatId 为空。");
  }
  if (!reminderKind) {
    throw new Error("未实质回复提醒状态写入失败：提醒类型为空。");
  }
  if (!runtimeState.reminderEventsByChatId || typeof runtimeState.reminderEventsByChatId !== "object") {
    runtimeState.reminderEventsByChatId = {};
  }

  const existingEvent = runtimeState.reminderEventsByChatId[identity.chatId];
  const baseEvent = existingEvent && isSameReminderEvent(existingEvent, candidate)
    ? existingEvent
    : {};
  runtimeState.reminderEventsByChatId[identity.chatId] = normalizeReminderEvent({
    ...baseEvent,
    ...identity,
    timeoutReminderSentAtMs:
      reminderKind === "timeout" ? Number(nowMs) : Number(baseEvent.timeoutReminderSentAtMs || 0),
    missedReplyReminderSentAtMs:
      reminderKind === "missedReply" ? Number(nowMs) : Number(baseEvent.missedReplyReminderSentAtMs || 0),
    lastReminderAtMs: Number(nowMs)
  });
}

function clearResolvedMissedReplyState(runtimeState, chatId) {
  // 这里在人工实质回复后只清掉防重复事件，提醒快照继续保留给页面复盘。
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId || !runtimeState.reminderEventsByChatId?.[normalizedChatId]) {
    return false;
  }

  delete runtimeState.reminderEventsByChatId[normalizedChatId];
  return true;
}

module.exports = {
  hasReminderKindBeenSent,
  shouldSendUnresolvedReplyReminder,
  markUnresolvedReplyReminderSent,
  clearResolvedMissedReplyState
};
