// 该文件用于整理漏回复过程看板所需的消息字段。
function buildReportMessages(messages) {
  // 这里只保留过程看板需要看的最小消息字段，避免把接口原始对象整坨写进报表。
  return messages.map((message) => ({
    role: message.role,
    isAutoReply: message.role === "bot",
    text: message.text
  }));
}

function buildLatestMessageFields(messages) {
  // 这里记录最后一条“客户或真实人工”消息；AI/自动回复不改变未回复判断，不能冒充最后依据。
  const latestMessage = Array.isArray(messages)
    ? messages.slice().reverse().find((message) => ["customer", "agent"].includes(message.role))
    : null;
  return {
    latestMessageRole: String(latestMessage?.role || ""),
    latestMessageSenderName: String(latestMessage?.senderName || ""),
    latestMessageText: String(latestMessage?.text || ""),
    latestMessageAtMs: Number(latestMessage?.timestampMs || 0)
  };
}

module.exports = {
  buildReportMessages,
  buildLatestMessageFields
};
