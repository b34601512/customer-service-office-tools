// 该文件用于把消息序列压成唯一的待回复责任。
const { classifyAgentReply } = require("../replyClassifier");
const {
  CUSTOMER_MESSAGE_DISPOSITION,
  classifyCustomerMessage
} = require("./customerMessageFilter");

function createAgentReplySummary() {
  return {
    substantiveReply: null,
    temporaryReply: null,
    invalidReply: null,
    latestAgentReply: null
  };
}

function recordAgentReply(summary, message, replyConfig) {
  const classifiedReply = {
    ...message,
    classification: classifyAgentReply(message, replyConfig)
  };
  summary.latestAgentReply = classifiedReply;

  if (classifiedReply.classification.kind === "substantive") {
    summary.substantiveReply = classifiedReply;
  } else if (classifiedReply.classification.kind === "temporary") {
    summary.temporaryReply = classifiedReply;
  } else {
    summary.invalidReply = classifiedReply;
  }
  return classifiedReply;
}

function createPendingReplyObligation(message, index) {
  const customer = { message, index };
  return {
    firstCustomer: customer,
    latestCustomer: customer,
    agentSummary: createAgentReplySummary()
  };
}

function closeObligationByCustomer(pending, message, index) {
  // 客户主动确认已解决时可以关闭旧责任；没有旧责任时也保留本次结案事实供现场解释。
  const resolved = pending || createPendingReplyObligation(message, index);
  return {
    ...resolved,
    latestCustomer: { message, index },
    resolutionKind: "customer",
    customerResolution: { message, index }
  };
}

function buildReplyObligation(messages, replyConfig) {
  // 一段责任从首条需处理客户消息开始，只能由人工实质回复或客户明确解决关闭。
  let pending = null;
  let lastResolved = null;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "customer") {
      const disposition = classifyCustomerMessage(message, replyConfig);
      if (disposition === CUSTOMER_MESSAGE_DISPOSITION.RESOLVES_PENDING) {
        lastResolved = closeObligationByCustomer(pending, message, index);
        pending = null;
      } else if (disposition === CUSTOMER_MESSAGE_DISPOSITION.NEEDS_HANDLING) {
        if (!pending) {
          pending = createPendingReplyObligation(message, index);
        } else {
          pending.latestCustomer = { message, index };
        }
      }
      continue;
    }

    if (message.role !== "agent" || !pending) {
      // AI、系统事件以及责任建立前的人工消息都不改变当前责任。
      continue;
    }

    const reply = recordAgentReply(pending.agentSummary, message, replyConfig);
    if (reply.classification.kind === "substantive") {
      lastResolved = {
        ...pending,
        resolutionKind: "agent",
        substantiveReply: reply
      };
      pending = null;
    }
  }

  return { pending, lastResolved };
}

function resolveUnresolvedReplyReason(agentSummary) {
  // 这里把未完成回复的原因压成一句短标签，方便群提醒和过程看板直接阅读。
  if (agentSummary.temporaryReply) {
    return "临时回复后未实质回复";
  }

  if (agentSummary.invalidReply) {
    return "人工回复无效";
  }

  return "客户消息后无人实质回复";
}

module.exports = {
  buildReplyObligation,
  closeObligationByCustomer,
  resolveUnresolvedReplyReason
};
