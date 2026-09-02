const test = require("node:test");
const assert = require("node:assert/strict");

const {
  analyzeUnresolvedReplyState,
  buildLatestMessageFields,
  buildUnresolvedReplyReminderDecision,
  resolveMissedReplyThresholdSeconds
} = require("../../src/features/missedReplyMonitor/missedReplyPolicy");

const NOW_MS = 1800000000000;
const replyConfig = {
  missedReplyTemporaryReplyKeywords: [
    "稍等",
    "请稍等",
    "我查一下",
    { text: "我帮您跟领导反馈一下看看吧", matchMode: "exact" },
    "1"
  ],
  missedReplyCustomerResolutionKeywords: [
    { text: "找到问题了", matchMode: "includes" }
  ],
  missedReplyCustomerClosingKeywords: ["谢谢", "好的", "嗯", "嗯嗯", "嗯呢"],
  missedReplyInvalidAgentReplyKeywords: [".", "。", "，", ",", "、", "...", "…"]
};

function createContact(overrides = {}) {
  return {
    chatId: "chat_1",
    customerName: "罗马假日",
    assignedToUserId: "staff_1",
    ...overrides
  };
}

function createMessage(overrides = {}) {
  return {
    id: overrides.id || `msg_${overrides.timestamp}`,
    timestamp: overrides.timestamp,
    role: overrides.role,
    text: overrides.text,
    content: overrides.content,
    ...overrides
  };
}

function analyzeDecision(messages, nowMs = NOW_MS, timeoutThresholdSeconds = 150) {
  const unresolvedState = analyzeUnresolvedReplyState(createContact(), messages, replyConfig, nowMs);
  return buildUnresolvedReplyReminderDecision(unresolvedState, timeoutThresholdSeconds);
}

test("客户消息后没有人工实质回复，超过首次阈值应该发超时提醒", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 160 * 1000,
      role: "customer",
      text: "帮我查一下订单"
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "timeout");
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
  assert.equal(decision.timeoutThresholdSeconds, 150);
  assert.equal(decision.missedReplyThresholdSeconds, 1500);
});

test("超过10倍阈值时应该直接发漏回复提醒，不再发第几次超时提醒", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "还没处理吗"
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal("reminderIndex" in decision, false);
});

test("客服只发稍等不算实质回复，应该跳过首次超时只等漏回复", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 300 * 1000,
      role: "customer",
      text: "帮我看下物流"
    }),
    createMessage({
      timestamp: NOW_MS - 100 * 1000,
      role: "agent",
      senderUserId: "staff_other",
      senderName: "马倩（售后客服）",
      text: "稍等"
    })
  ]);

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.reasonLabel, "临时回复后未实质回复");
  assert.equal(decision.reason, "已有人工临时回复，只等待漏回复提醒阈值");
  assert.equal(decision.isPendingTimeoutReplyCandidate, false);
  assert.equal(decision.isPendingMissedReplyCandidate, true);
  assert.equal(decision.recentAgentReplyText, "稍等");
  assert.equal("agentHandlerCandidates" in decision, false);
  assert.equal(decision.pendingSinceAtMs, NOW_MS - 300 * 1000);
  assert.equal(decision.pendingDurationSeconds, 300);
});

test("标记已读应该被完全忽略并继续触发首次超时", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 300 * 1000,
      role: "customer",
      text: "我的订单呢"
    }),
    createMessage({
      timestamp: NOW_MS - 100 * 1000,
      content: {
        type: 10000,
        content: "郑兰（售后客服）将此对话标为已读"
      }
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "timeout");
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
  assert.equal(decision.recentAgentReplyText, "");
  assert.equal(decision.latestMessageRole, "customer");
  assert.equal(decision.pendingSinceAtMs, NOW_MS - 300 * 1000);
});

test("客服只发稍等超过10倍阈值后才应该发漏回复提醒", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "帮我看下物流"
    }),
    createMessage({
      timestamp: NOW_MS - 100 * 1000,
      role: "agent",
      text: "稍等"
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.reasonLabel, "临时回复后未实质回复");
  assert.equal(decision.isPendingTimeoutReplyCandidate, false);
});

test("AI或机器人自动回复不应该清掉未实质回复", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 160 * 1000,
      role: "customer",
      text: "这个怎么处理"
    }),
    createMessage({
      timestamp: NOW_MS - 150 * 1000,
      role: "bot",
      text: "您好，我是智能助手"
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
  assert.equal(decision.latestMessageRole, "customer");
  assert.equal(decision.latestMessageText, "这个怎么处理");
});

test("AI回复后标记已读仍应该按原责任触发漏回复", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "这个怎么处理"
    }),
    createMessage({
      timestamp: NOW_MS - 1500 * 1000,
      role: "bot",
      text: "您好，我是智能助手"
    }),
    createMessage({
      timestamp: NOW_MS - 1400 * 1000,
      content: {
        type: 10000,
        content: "郑兰（售后客服）将此对话标为已读"
      }
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
  assert.equal(decision.isPendingTimeoutReplyCandidate, true);
  assert.equal(decision.isPendingMissedReplyCandidate, true);
  assert.equal(decision.recentAgentReplyText, "");
});

test("标记已读和AI的先后顺序都不应该改变待回复责任", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "这个怎么处理"
    }),
    createMessage({
      timestamp: NOW_MS - 1500 * 1000,
      content: {
        type: 10000,
        content: "郑兰（售后客服）将此对话标为已读"
      }
    }),
    createMessage({
      timestamp: NOW_MS - 1400 * 1000,
      role: "bot",
      text: "您好，我是智能助手"
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
});

test("客户追问不应该被AI和已读清掉，也不应该重置原计时", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "这个怎么处理"
    }),
    createMessage({
      timestamp: NOW_MS - 1500 * 1000,
      role: "bot",
      text: "您好，我是智能助手"
    }),
    createMessage({
      timestamp: NOW_MS - 1400 * 1000,
      content: {
        type: 10000,
        content: "郑兰（售后客服）将此对话标为已读"
      }
    }),
    createMessage({
      timestamp: NOW_MS - 100 * 1000,
      role: "customer",
      text: "那另外一个问题呢"
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.isPendingUnresolvedReplyCandidate, true);
  assert.equal(decision.lastCustomerMessageText, "那另外一个问题呢");
  assert.equal(decision.pendingSinceAtMs, NOW_MS - 1600 * 1000);
  assert.equal(decision.pendingDurationSeconds, 1600);
});

test("客服发标点不算人工响应，仍应该触发首次超时", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 160 * 1000,
      role: "customer",
      text: "还在吗"
    }),
    createMessage({
      timestamp: NOW_MS - 150 * 1000,
      role: "agent",
      text: "。"
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "timeout");
  assert.equal(decision.reasonLabel, "人工回复无效");
  assert.equal(decision.isPendingTimeoutReplyCandidate, true);
});

test("客服有新的实质回复后不应该提醒", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "帮我看下物流"
    }),
    createMessage({
      timestamp: NOW_MS - 1500 * 1000,
      role: "agent",
      text: "已经帮您查到，今天会派送"
    })
  ]);

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "客户消息后已有人工实质回复");
  assert.equal(decision.substantiveReplyAtMs, NOW_MS - 1500 * 1000);
});

test("客户最后只发弱收尾，不应该单独触发提醒", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "嗯嗯"
    })
  ]);

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "客户最后消息是弱收尾");
  assert.equal(decision.lastCustomerMessageText, "嗯嗯");
});

test("客户最后只发弱收尾组合句，不应该单独触发漏回复", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "好的谢谢"
    })
  ]);

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "客户最后消息是弱收尾");
  assert.equal(decision.lastCustomerMessageText, "好的谢谢");
});

test("客户明确表示问题已解决时应该关闭此前未回复责任", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "这个透明管子接哪里"
    }),
    createMessage({
      timestamp: NOW_MS - 100 * 1000,
      role: "customer",
      text: "嗯找到问题了"
    }),
    createMessage({
      timestamp: NOW_MS - 90 * 1000,
      role: "bot",
      text: "不用客气的哈[玫瑰]"
    })
  ]);

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "客户明确表示问题已解决");
  assert.equal(decision.lastCustomerMessageText, "嗯找到问题了");
  assert.equal(decision.customerResolutionAtMs, NOW_MS - 100 * 1000);
  assert.equal(decision.latestMessageRole, "customer");
});

test("客户弱收尾不能关闭此前尚未处理的责任", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "帮我申请一下"
    }),
    createMessage({
      timestamp: NOW_MS - 100 * 1000,
      role: "customer",
      text: "好的谢谢"
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.lastCustomerMessageText, "帮我申请一下");
  assert.equal(decision.pendingSinceAtMs, NOW_MS - 1600 * 1000);
});

test("客服承诺向领导反馈后即使客户客套和AI回复也应该继续漏回复", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "给老板申请申请嘛"
    }),
    createMessage({
      timestamp: NOW_MS - 1500 * 1000,
      role: "agent",
      text: "我帮您跟领导反馈一下看看吧"
    }),
    createMessage({
      timestamp: NOW_MS - 1490 * 1000,
      role: "customer",
      text: "嗨好的谢谢"
    }),
    createMessage({
      timestamp: NOW_MS - 1480 * 1000,
      role: "bot",
      text: "不用客气的哈[玫瑰]"
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.reasonLabel, "临时回复后未实质回复");
  assert.equal(decision.recentAgentReplyText, "我帮您跟领导反馈一下看看吧");
  assert.equal(decision.pendingSinceAtMs, NOW_MS - 1600 * 1000);
});

test("客户只发纯小程序卡片不应该触发超时或漏回复", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      content: {
        type: 9,
        title: "广告小程序",
        description: "点击查看活动"
      }
    })
  ]);

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "客户最后消息是纯小程序卡片");
  assert.equal(decision.lastCustomerMessageText, "广告小程序");
});

test("客户先提问再发纯小程序卡片时仍应该按前一条问题计时", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "帮我查一下订单"
    }),
    createMessage({
      timestamp: NOW_MS - 100 * 1000,
      role: "customer",
      content: {
        type: 9,
        title: "订单小程序"
      }
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.lastCustomerMessageText, "帮我查一下订单");
  assert.equal(decision.pendingDurationSeconds, 1600);
});

test("客户发小程序同时带正文问题时仍应该触发待回复", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 160 * 1000,
      role: "customer",
      content: {
        type: 9,
        text: "这个活动还能用吗",
        title: "活动小程序"
      }
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "timeout");
  assert.equal(decision.lastCustomerMessageText, "这个活动还能用吗");
});

test("客户连续追问应该展示最新内容但从首条未解决消息计时", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "帮我查一下订单"
    }),
    createMessage({
      timestamp: NOW_MS - 100 * 1000,
      role: "customer",
      text: "还有这个地址也看下"
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.isPendingUnresolvedReplyCandidate, true);
  assert.equal(decision.lastCustomerMessageText, "还有这个地址也看下");
  assert.equal(decision.pendingSinceAtMs, NOW_MS - 1600 * 1000);
  assert.equal(decision.pendingDurationSeconds, 1600);
});

test("人工实质回复后的新问题应该开启新的待回复责任", () => {
  const decision = analyzeDecision([
    createMessage({
      timestamp: NOW_MS - 1600 * 1000,
      role: "customer",
      text: "旧问题"
    }),
    createMessage({
      timestamp: NOW_MS - 1500 * 1000,
      role: "agent",
      text: "旧问题已经处理完成"
    }),
    createMessage({
      timestamp: NOW_MS - 100 * 1000,
      role: "customer",
      text: "新的问题"
    })
  ]);

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.isPendingUnresolvedReplyCandidate, true);
  assert.equal(decision.pendingSinceAtMs, NOW_MS - 100 * 1000);
  assert.equal(decision.lastCustomerMessageText, "新的问题");
});

test("最后有效消息应该只看客户和真实人工，忽略 AI 自动回复", () => {
  const latestMessage = buildLatestMessageFields([
    {
      role: "customer",
      senderName: "客户A",
      text: "帮我查一下",
      timestampMs: NOW_MS - 3000
    },
    {
      role: "agent",
      senderName: "客服A",
      text: "我来处理",
      timestampMs: NOW_MS - 2000
    },
    {
      role: "bot",
      senderName: "AI助手",
      text: "自动回复内容",
      timestampMs: NOW_MS - 1000
    }
  ]);

  assert.deepEqual(latestMessage, {
    latestMessageRole: "agent",
    latestMessageSenderName: "客服A",
    latestMessageText: "我来处理",
    latestMessageAtMs: NOW_MS - 2000
  });
});

test("漏回复阈值应该固定等于首次超时阈值的10倍", () => {
  assert.equal(resolveMissedReplyThresholdSeconds(150), 1500);
});
