// 该文件用于对外分析会话是否处于未实质回复状态。
const { normalizeConversationMessages } = require("../messageNormalization");
const { buildEmptyUnresolvedReplyDecision } = require("./emptyDecision");
const { normalizeContactText } = require("./contactText");
const { buildLatestMessageFields, buildReportMessages } = require("./reportMessages");
const {
  findLatestCustomerMessage,
  resolveNoNeedToHandleCustomerReason
} = require("./customerMessageFilter");
const { buildReplyObligation } = require("./replyObligation");
const { buildUnresolvedReplyBase } = require("./unresolvedReplyBase");
const {
  findLatestUnreachableContactNotice,
  isUnreachableContactNoticeAfterMessage
} = require("./unreachableContactNotice");

const UNREACHABLE_CONTACT_REASON = "客户已不是联系人，无法发送消息";

function buildResolvedReplyDecision(input) {
  const firstCustomerMessage = input.resolved.firstCustomer.message;
  const resolvedByCustomer = input.resolved.resolutionKind === "customer";
  const latestCustomerMessage = resolvedByCustomer
    ? input.resolved.customerResolution.message
    : input.resolved.latestCustomer.message;
  const substantiveReply = input.resolved.substantiveReply;
  const resolutionMessage = resolvedByCustomer ? latestCustomerMessage : substantiveReply;
  const reason = resolvedByCustomer ? "客户明确表示问题已解决" : "客户消息后已有人工实质回复";
  return buildEmptyUnresolvedReplyDecision(reason, {
    ...input.contactFields,
    ...input.latestMessageFields,
    lastCustomerMessageAtMs: Number(latestCustomerMessage.timestampMs || 0),
    lastCustomerMessageText: String(latestCustomerMessage.text || ""),
    pendingSinceAtMs: Number(firstCustomerMessage.timestampMs || 0),
    recentAgentReplyText: resolvedByCustomer
      ? String(
        input.resolved.agentSummary.temporaryReply?.text ||
        input.resolved.agentSummary.latestAgentReply?.text ||
        ""
      )
      : String(substantiveReply.text || ""),
    substantiveReplyAtMs: resolvedByCustomer ? 0 : Number(substantiveReply.timestampMs || 0),
    customerResolutionAtMs: resolvedByCustomer ? Number(latestCustomerMessage.timestampMs || 0) : 0,
    pendingDurationSeconds: Math.max(
      0,
      Math.floor((resolutionMessage.timestampMs - firstCustomerMessage.timestampMs) / 1000)
    ),
    messages: buildReportMessages(input.messages)
  });
}

function analyzeUnresolvedReplyState(contact, rawMessages, replyConfig, nowMs = Date.now()) {
  // 这里只裁决唯一待回复责任；已读、AI 和客户追问都不能关闭或重置它。
  const chatId = normalizeContactText(contact?.chatId);
  const customerName = normalizeContactText(contact?.customerName);
  const assignedToUserId = normalizeContactText(contact?.assignedToUserId);
  if (!chatId || !customerName) {
    return buildEmptyUnresolvedReplyDecision("会话缺少 chatId 或客户名");
  }

  const messages = normalizeConversationMessages(rawMessages, contact, replyConfig);
  const contactFields = {
    chatId,
    customerName,
    assignedToUserId
  };
  const latestMessageFields = buildLatestMessageFields(messages);
  const obligation = buildReplyObligation(messages, replyConfig);

  if (!obligation.pending) {
    if (obligation.lastResolved) {
      return buildResolvedReplyDecision({
        resolved: obligation.lastResolved,
        contactFields,
        latestMessageFields,
        messages
      });
    }

    const latestCustomer = findLatestCustomerMessage(messages);
    return buildEmptyUnresolvedReplyDecision(resolveNoNeedToHandleCustomerReason(latestCustomer, replyConfig), {
      ...contactFields,
      ...latestMessageFields,
      lastCustomerMessageAtMs: Number(latestCustomer?.message?.timestampMs || 0),
      lastCustomerMessageText: String(latestCustomer?.message?.text || ""),
      pendingSinceAtMs: Number(latestCustomer?.message?.timestampMs || 0),
      pendingDurationSeconds:
        latestCustomer?.message?.timestampMs
          ? Math.max(0, Math.floor((nowMs - latestCustomer.message.timestampMs) / 1000))
          : 0,
      messages: buildReportMessages(messages)
    });
  }

  const firstCustomer = obligation.pending.firstCustomer;
  const latestCustomer = obligation.pending.latestCustomer;
  const latestUnreachableContactNotice = findLatestUnreachableContactNotice(rawMessages, replyConfig);
  if (isUnreachableContactNoticeAfterMessage(latestUnreachableContactNotice, latestCustomer.message)) {
    return buildEmptyUnresolvedReplyDecision(UNREACHABLE_CONTACT_REASON, {
      ...contactFields,
      ...latestMessageFields,
      lastCustomerMessageAtMs: Number(latestCustomer.message.timestampMs || 0),
      lastCustomerMessageText: String(latestCustomer.message.text || ""),
      pendingSinceAtMs: Number(firstCustomer.message.timestampMs || 0),
      recentAgentReplyText: latestUnreachableContactNotice.text,
      pendingDurationSeconds: Math.max(0, Math.floor((nowMs - firstCustomer.message.timestampMs) / 1000)),
      messages: buildReportMessages(messages)
    });
  }

  return {
    ...buildUnresolvedReplyBase({
      chatId,
      customerName,
      assignedToUserId,
      pendingStartCustomerMessage: firstCustomer.message,
      latestCustomerMessage: latestCustomer.message,
      agentSummary: obligation.pending.agentSummary,
      messages,
      nowMs
    }),
    shouldRemind: false,
    reminderKind: "",
    reason: "未实质回复",
    isPendingUnresolvedReplyCandidate: true,
    isPendingTimeoutReplyCandidate: !obligation.pending.agentSummary.temporaryReply,
    isPendingMissedReplyCandidate: true
  };
}

module.exports = {
  analyzeUnresolvedReplyState
};
