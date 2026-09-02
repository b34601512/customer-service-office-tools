// 该文件用于构建未实质回复基础状态。
const { buildLatestMessageFields, buildReportMessages } = require("./reportMessages");
const { resolveUnresolvedReplyReason } = require("./replyObligation");

function buildUnresolvedReplyBase(input) {
  // 这里把未实质回复会话压成统一结构，提醒阶段只在这个基础上判断。
  const pendingStartMessage = input.pendingStartCustomerMessage;
  const latestCustomerMessage = input.latestCustomerMessage;
  const pendingSinceAtMs = Number(pendingStartMessage.timestampMs || 0);
  const pendingDurationSeconds = Math.max(0, Math.floor((input.nowMs - pendingSinceAtMs) / 1000));
  return {
    chatId: input.chatId,
    customerName: input.customerName,
    assignedToUserId: input.assignedToUserId,
    ...buildLatestMessageFields(input.messages),
    lastCustomerMessageAtMs: Number(latestCustomerMessage.timestampMs || 0),
    lastCustomerMessageText: String(latestCustomerMessage.text || ""),
    pendingSinceAtMs,
    recentAgentReplyText: input.agentSummary.temporaryReply?.text || input.agentSummary.latestAgentReply?.text || "",
    pendingDurationSeconds,
    reasonLabel: resolveUnresolvedReplyReason(input.agentSummary),
    hasTemporaryReplyAfterCustomer: Boolean(input.agentSummary.temporaryReply),
    messages: buildReportMessages(input.messages)
  };
}

module.exports = {
  buildUnresolvedReplyBase
};
