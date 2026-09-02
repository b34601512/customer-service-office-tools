const {
  hasAttachmentSignal,
  hasMiniProgramAttachmentSignal,
  hasMiniProgramTextSignal
} = require("./attachmentDetector");
const { parseJsonLikeContent, resolveDirectMessageText, resolveMessageText } = require("./contentParser");
const { resolveMessageRole } = require("./roleResolver");
const { resolveSenderName, resolveSenderProfile } = require("./senderResolver");
const { normalizeTimestamp } = require("./timestampNormalizer");

function normalizeConversationMessage(message, contact, replyConfig = {}) {
  // 这里把单条原始消息压成统一未回复引擎需要的最小事实。
  const content = parseJsonLikeContent(message?.content);
  const text = resolveMessageText(message, content);
  const directText = resolveDirectMessageText(message, content);
  const isMiniProgramAttachment = hasMiniProgramAttachmentSignal(message, content, text);
  const senderProfile = resolveSenderProfile(message, content);
  const role = resolveMessageRole(message, content, contact, senderProfile, replyConfig);
  return {
    id: String(message?.id || message?.messageId || message?.key || "").trim(),
    timestampMs: normalizeTimestamp(
      message?.timestamp || message?.createdAt || message?.createTime || message?.sendTime || message?.time
    ),
    role,
    senderUserId: String(senderProfile.sendById || "").trim(),
    senderName: resolveSenderName(senderProfile, contact, role),
    text,
    hasAttachment: hasAttachmentSignal(message, content, text),
    isMiniProgramAttachment,
    hasCustomerWrittenText: Boolean(directText) && !(isMiniProgramAttachment && hasMiniProgramTextSignal(directText)),
    rawType: Number(content?.type ?? message?.type)
  };
}

function normalizeConversationMessages(messages, contact, replyConfig = {}) {
  // 这里只保留有时间且角色明确的客户、人工和自动回复消息，再按时间升序交给策略层。
  return (Array.isArray(messages) ? messages : [])
    .map((message) => normalizeConversationMessage(message, contact, replyConfig))
    .filter((message) => message.timestampMs > 0 && message.role !== "system" && message.role !== "unknown")
    .sort((left, right) => left.timestampMs - right.timestampMs);
}

module.exports = {
  normalizeConversationMessage,
  normalizeConversationMessages
};
