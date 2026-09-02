// 该文件用于筛出真正需要人工处理的客户消息。
const {
  isCustomerClosingMessage,
  isCustomerResolutionMessage,
  isPurePunctuation,
  isEmojiOnlyText,
  normalizeText
} = require("../replyClassifier");

const CUSTOMER_MESSAGE_DISPOSITION = Object.freeze({
  NEEDS_HANDLING: "needs_handling",
  RESOLVES_PENDING: "resolves_pending",
  IGNORED: "ignored"
});

function classifyCustomerMessage(message, replyConfig) {
  // 这里把客户消息分成“需处理、明确解决、忽略”三类，责任状态机只消费这一份裁决。
  const text = normalizeText(message?.text);
  if (isPureMiniProgramCard(message)) {
    return CUSTOMER_MESSAGE_DISPOSITION.IGNORED;
  }

  if (message?.hasAttachment) {
    return CUSTOMER_MESSAGE_DISPOSITION.NEEDS_HANDLING;
  }

  if (isPurePunctuation(text) || isEmojiOnlyText(text) || !text) {
    return CUSTOMER_MESSAGE_DISPOSITION.IGNORED;
  }

  if (isCustomerResolutionMessage(message, replyConfig)) {
    return CUSTOMER_MESSAGE_DISPOSITION.RESOLVES_PENDING;
  }

  if (isCustomerClosingMessage(message, replyConfig)) {
    return CUSTOMER_MESSAGE_DISPOSITION.IGNORED;
  }

  return CUSTOMER_MESSAGE_DISPOSITION.NEEDS_HANDLING;
}

function isNeedToHandleCustomerMessage(message, replyConfig) {
  // 兼容只需要布尔结果的调用方；真正的三态业务含义由 classifyCustomerMessage 给出。
  return classifyCustomerMessage(message, replyConfig) === CUSTOMER_MESSAGE_DISPOSITION.NEEDS_HANDLING;
}

function isPureMiniProgramCard(message) {
  // 这里只排除客户没有额外打字的小程序卡片，避免广告类卡片误触发督办。
  return Boolean(message?.isMiniProgramAttachment) && !message?.hasCustomerWrittenText;
}

function findLatestCustomerMessage(messages) {
  // 这里单独记录最后一条客户消息，方便解释为什么没有进入未实质回复倒计时。
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "customer") {
      return {
        message,
        index
      };
    }
  }

  return null;
}

function resolveNoNeedToHandleCustomerReason(latestCustomer, replyConfig) {
  // 这里把“不需要处理”拆成可读原因，避免现场只能看到一条笼统结论。
  if (!latestCustomer?.message) {
    return "没有客户消息";
  }

  const message = latestCustomer.message;
  const text = normalizeText(message.text);
  if (isPureMiniProgramCard(message)) {
    return "客户最后消息是纯小程序卡片";
  }
  if (message.hasAttachment) {
    return "客户附件消息未进入处理队列";
  }
  if (isPurePunctuation(text) || isEmojiOnlyText(text)) {
    return "客户最后消息是标点或表情";
  }
  if (!text) {
    return "客户最后消息为空";
  }
  if (isCustomerResolutionMessage(message, replyConfig)) {
    return "客户明确表示问题已解决";
  }
  if (isCustomerClosingMessage(message, replyConfig)) {
    return "客户最后消息是弱收尾";
  }

  return "没有需要处理的客户消息";
}

module.exports = {
  CUSTOMER_MESSAGE_DISPOSITION,
  classifyCustomerMessage,
  isNeedToHandleCustomerMessage,
  isPureMiniProgramCard,
  findLatestCustomerMessage,
  resolveNoNeedToHandleCustomerReason
};
