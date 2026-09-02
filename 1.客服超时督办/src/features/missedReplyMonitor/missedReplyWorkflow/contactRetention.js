// 该文件用于保留暂时离开联系人快照的待回复责任索引。
const {
  clearResolvedMissedReplyState,
  clearUnresolvedReplyCountdownItem,
  clearUnresolvedReplyDecisionItem,
  clearUnresolvedReplyReminderSnapshot
} = require("../missedReplyStateStore");

function normalizeChatId(value) {
  return String(value || "").trim();
}

function isPendingDecision(item) {
  return Boolean(item?.isPendingTimeoutReplyCandidate || item?.isPendingMissedReplyCandidate);
}

function buildRetainedContact(item) {
  return {
    chatId: normalizeChatId(item?.chatId),
    customerName: String(item?.customerName || "未识别客户").trim() || "未识别客户",
    // 联系人不在本轮接口快照时，不能把本地旧分配冒充平台当前分配。
    assignedToUserId: "",
    previewText: String(item?.previewText || item?.lastCustomerMessageText || ""),
    contactListIndex: 0,
    retainedPendingContact: true
  };
}

function mergeRetainedPendingContacts(runtimeState, contacts, excludedContacts = []) {
  // 当前接口快照优先；本地状态仅提供待重新读取消息的 chatId 索引，不参与最终业务裁决。
  const normalizedContacts = Array.isArray(contacts) ? contacts : [];
  const currentChatIds = new Set(normalizedContacts.map((item) => normalizeChatId(item?.chatId)).filter(Boolean));
  const excludedChatIds = new Set(
    (Array.isArray(excludedContacts) ? excludedContacts : [])
      .map((item) => normalizeChatId(item?.chatId))
      .filter(Boolean)
  );
  const retainedByChatId = new Map();

  for (const item of Object.values(runtimeState?.decisionItemsByChatId || {})) {
    const chatId = normalizeChatId(item?.chatId);
    if (!chatId || currentChatIds.has(chatId) || excludedChatIds.has(chatId) || !isPendingDecision(item)) {
      continue;
    }
    retainedByChatId.set(chatId, buildRetainedContact(item));
  }

  for (const item of Object.values(runtimeState?.countdownItemsByChatId || {})) {
    const chatId = normalizeChatId(item?.chatId);
    if (!chatId || currentChatIds.has(chatId) || excludedChatIds.has(chatId) || retainedByChatId.has(chatId)) {
      continue;
    }
    retainedByChatId.set(chatId, buildRetainedContact(item));
  }

  return [...normalizedContacts, ...retainedByChatId.values()];
}

function clearExplicitlyExcludedContacts(runtimeState, excludedContacts) {
  // 群聊是接口明确给出的排除事实，可以清理；普通“本轮没出现”不能据此判定责任消失。
  for (const contact of Array.isArray(excludedContacts) ? excludedContacts : []) {
    const chatId = normalizeChatId(contact?.chatId);
    if (!chatId) {
      continue;
    }
    clearResolvedMissedReplyState(runtimeState, chatId);
    clearUnresolvedReplyCountdownItem(runtimeState, chatId);
    clearUnresolvedReplyDecisionItem(runtimeState, chatId);
    clearUnresolvedReplyReminderSnapshot(runtimeState, chatId);
  }
}

function pruneMissingResolvedDecisionItems(runtimeState, monitoredContacts) {
  // 已解决展示项可随接口列表离开而清理；未解决项必须保留到消息事实确认结案。
  const monitoredChatIds = new Set(
    (Array.isArray(monitoredContacts) ? monitoredContacts : [])
      .map((item) => normalizeChatId(item?.chatId))
      .filter(Boolean)
  );
  for (const [chatId, item] of Object.entries(runtimeState?.decisionItemsByChatId || {})) {
    if (!monitoredChatIds.has(chatId) && !isPendingDecision(item)) {
      clearUnresolvedReplyDecisionItem(runtimeState, chatId);
    }
  }
}

module.exports = {
  clearExplicitlyExcludedContacts,
  mergeRetainedPendingContacts,
  pruneMissingResolvedDecisionItems
};
