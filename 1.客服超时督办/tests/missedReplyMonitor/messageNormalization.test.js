const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeConversationMessage,
  normalizeConversationMessages
} = require("../../src/features/missedReplyMonitor/messageNormalization");
const {
  analyzeUnresolvedReplyState,
  buildUnresolvedReplyReminderDecision,
  buildLatestMessageFields
} = require("../../src/features/missedReplyMonitor/missedReplyPolicy");

const NOW_MS = new Date("2026-06-26T15:00:00+08:00").getTime();
const replyConfig = {
  missedReplyTemporaryReplyKeywords: ["稍等", "请稍等", "我查一下", "1"],
  missedReplyCustomerClosingKeywords: ["谢谢", "好的", "嗯", "嗯嗯", "嗯呢"],
  missedReplyInvalidAgentReplyKeywords: [".", "。", "，", ",", "、", "...", "…"],
  missedReplyPlatformNoticeKeywords: [
    { text: "我已经添加了你", matchMode: "startsWith" },
    { text: "你已添加了", matchMode: "startsWith" }
  ],
  missedReplyUnreachableContactKeywords: [
    { text: "你还不是他（她）的联系人", matchMode: "includes" },
    { text: "请先发送联系人验证请求，对方验证通过后，才能聊天", matchMode: "includes" }
  ]
};

function analyzeDecision(contact, rawMessages, nowMs = NOW_MS) {
  const unresolvedState = analyzeUnresolvedReplyState(contact, rawMessages, replyConfig, nowMs);
  return buildUnresolvedReplyReminderDecision(unresolvedState, 150);
}

function createContact() {
  return {
    chatId: "6a3e1d3667294fcd7913893d",
    customerName: "刘利军",
    assignedToUserId: "698059a50e5aff4949befdcd"
  };
}

function createPlatformMessage(overrides = {}) {
  return {
    id: overrides.id || `msg_${overrides.timestamp}`,
    chatId: "6a3e1d3667294fcd7913893d",
    timestamp: overrides.timestamp,
    content: overrides.content,
    from: overrides.from,
    clientId: overrides.clientId ?? null,
    readList: null
  };
}

function createCustomerFrom(name = "刘利军") {
  return {
    isSelf: false,
    contactId: "7881302983107260",
    coworker: false,
    contactType: 1,
    displayName: name,
    corporation: "",
    sendBy: {
      id: "",
      name: "",
      source: null
    }
  };
}

function createAgentFrom(name = "马倩（售后客服）") {
  return {
    isSelf: true,
    contactId: "1688856305579607",
    coworker: true,
    contactType: 3,
    displayName: "雪儿",
    corporation: "德达集团",
    sendBy: {
      id: "698059a50e5aff4949befdcd",
      name,
      source: 1
    }
  };
}

function createMobileAgentFrom(name = "苏哲（售后组长）") {
  // 企微手机端回复：sendBy.source=0 且 sendBy.name="来自手机"，displayName 才是真实客服名。
  return {
    isSelf: true,
    contactId: "1688849977538386",
    coworker: true,
    contactType: 3,
    displayName: name,
    corporation: "德达集团",
    sendBy: {
      id: "",
      name: "来自手机",
      source: 0
    }
  };
}

function createCoworkerFrom(name = "杨考深（京东运营）") {
  // 公司内部同事发的消息：coworker=true、带公司归属，但不是当前登录账号（isSelf=false）。
  return {
    isSelf: false,
    contactId: "1688855972710072",
    coworker: true,
    contactType: 3,
    displayName: name,
    corporation: "德达集团",
    sendBy: { id: "", name: "", source: null }
  };
}

function createBotFrom() {
  return {
    isSelf: true,
    contactId: "1688856305579607",
    coworker: true,
    contactType: 3,
    displayName: "雪儿",
    corporation: "德达集团",
    sendBy: {
      id: "",
      name: "自动回复",
      source: 3
    }
  };
}

function createApiBotFrom() {
  return {
    isSelf: true,
    contactId: "1688856305579607",
    coworker: true,
    contactType: 3,
    displayName: "雪儿",
    corporation: "德达集团",
    sendBy: {
      id: "",
      name: "AI-API",
      source: 9
    }
  };
}

test("真实平台 from 字段应该能识别客户、人工客服、自动回复和系统消息", () => {
  const contact = createContact();
  const normalizedMessages = normalizeConversationMessages([
    createPlatformMessage({
      timestamp: NOW_MS - 1000,
      content: { type: 7, content: "不用客气的哈" },
      from: createBotFrom()
    }),
    createPlatformMessage({
      timestamp: NOW_MS - 2000,
      content: { type: 7, content: "[玫瑰]" },
      from: createAgentFrom()
    }),
    createPlatformMessage({
      timestamp: NOW_MS - 3000,
      content: { type: 7, content: "谢谢" },
      from: createCustomerFrom()
    }),
    createPlatformMessage({
      timestamp: NOW_MS - 4000,
      content: { type: 10000, content: "" },
      from: {
        isSelf: false,
        coworker: false,
        contactType: 0,
        displayName: "",
        sendBy: { id: "", name: "" }
      }
    })
  ], contact, replyConfig);

  assert.deepEqual(normalizedMessages.map((message) => message.role), ["customer", "agent", "bot"]);
  assert.equal(normalizedMessages[0].senderName, "刘利军");
  assert.equal(normalizedMessages[1].senderName, "马倩（售后客服）");
  assert.equal(normalizedMessages[1].senderUserId, "698059a50e5aff4949befdcd");
  assert.equal(normalizedMessages[2].senderName, "自动回复");
  assert.equal(buildLatestMessageFields(normalizedMessages).latestMessageRole, "agent");
});

test("真实平台自动回复不应该冒充最后一条有效人工回复", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 1600 * 1000,
        content: { type: 7, content: "你好。" },
        from: createCustomerFrom()
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 1500 * 1000,
        content: { type: 7, content: "您好，我是智能助手" },
        from: createBotFrom()
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
  assert.equal(decision.latestMessageRole, "customer");
  assert.equal(decision.latestMessageSenderName, "刘利军");
  assert.equal(decision.latestMessageText, "你好。");
});

test("真实平台AI回复后标记已读仍应该触发漏回复", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 1600 * 1000,
        content: { type: 7, content: "你好。" },
        from: createCustomerFrom()
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 1500 * 1000,
        content: { type: 7, content: "您好，我是智能助手" },
        from: createBotFrom()
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 1400 * 1000,
        content: { type: 10000, content: "郑兰（售后客服）将此对话标为已读" },
        from: {
          isSelf: false,
          coworker: false,
          contactType: 0,
          displayName: "",
          sendBy: { id: "", name: "" }
        }
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
  assert.equal(decision.latestMessageRole, "customer");
  assert.equal(decision.latestMessageText, "你好。");
});

test("真实平台AI回复后空正文payload已读事件也应该被忽略", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 1600 * 1000,
        content: { type: 7, content: "你们有以旧换新吗" },
        from: createCustomerFrom("明")
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 1500 * 1000,
        content: { type: 7, content: "一、【以旧换新】怎么操作？" },
        from: createBotFrom()
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 1400 * 1000,
        content: {
          type: 10000,
          payload: {
            type: 1,
            subPayload: {
              opUser: {
                userId: "698047a80e5aff4949933b7f",
                username: "卢安（售后客服）"
              }
            }
          },
          content: ""
        },
        from: {
          isSelf: false,
          coworker: false,
          contactType: 0,
          displayName: "",
          sendBy: { id: "", name: "" }
        }
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
  assert.equal(decision.latestMessageRole, "customer");
  assert.equal(decision.latestMessageSenderName, "明");
  assert.equal(decision.latestMessageText, "你们有以旧换新吗");
});

test("真实平台人工 source=1 回复后应该清掉超时和漏回复候选", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 1600 * 1000,
        content: { type: 7, content: "您好这是干啥用的" },
        from: createCustomerFrom()
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 1500 * 1000,
        content: { type: 7, content: "备用过滤棉哦" },
        from: createAgentFrom()
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "客户消息后已有人工实质回复");
  assert.equal(decision.latestMessageRole, "agent");
  assert.equal(decision.latestMessageSenderName, "马倩（售后客服）");
  assert.equal(decision.latestMessageText, "备用过滤棉哦");
});

test("企微手机端“来自手机”回复（source=0）应该清掉超时和漏回复候选", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 1600 * 1000,
        content: { type: 7, content: "您好这是干啥用的" },
        from: createCustomerFrom()
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 1500 * 1000,
        content: { type: 7, content: "换机器原本那根" },
        from: createMobileAgentFrom()
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "客户消息后已有人工实质回复");
  assert.equal(decision.latestMessageRole, "agent");
  assert.equal(decision.latestMessageSenderName, "苏哲（售后组长）");
  assert.equal(decision.latestMessageText, "换机器原本那根");
});

test("企微手机端回复带附件（type=6 图片）应该算实质回复", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 1600 * 1000,
        content: { type: 7, content: "发一下配置图" },
        from: createCustomerFrom()
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 1500 * 1000,
        content: { type: 6, content: "" },
        from: createMobileAgentFrom()
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "客户消息后已有人工实质回复");
  assert.equal(decision.latestMessageRole, "agent");
  assert.equal(decision.latestMessageText, "[图片]");
});

test("公司内部同事发的消息不应该当成客户消息触发提醒", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 1600 * 1000,
        content: { type: 7, content: "这个等晚上吧，这样客户才有空处理" },
        from: createCoworkerFrom()
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.latestMessageRole, "agent");
});

test("带公司归属的非本人消息也应该识别为内部人员而不是客户", () => {
  const normalized = normalizeConversationMessage(
    createPlatformMessage({
      timestamp: NOW_MS - 1000,
      content: { type: 7, content: "内部协调一下" },
      from: {
        isSelf: false,
        contactId: "1688855972710072",
        coworker: false,
        contactType: 3,
        displayName: "运营-陈晓",
        corporation: "德达集团",
        sendBy: { id: "", name: "", source: null }
      }
    }),
    createContact(),
    replyConfig
  );
  assert.equal(normalized.role, "agent");
});

test("平台 type=7 普通文字不能被当成附件绕过弱收尾判断", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 1600 * 1000,
        content: { type: 7, content: "谢谢" },
        from: createCustomerFrom()
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "客户最后消息是弱收尾");
  assert.equal(decision.lastCustomerMessageText, "谢谢");
});

test("平台自动消息顶起旧弱收尾组合句不应该触发漏回复", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 1600 * 1000,
        content: { type: 7, content: "好的谢谢" },
        from: createCustomerFrom("Michelle S")
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 100 * 1000,
        content: { type: 7, content: "亲爱的~您的订单已签收啦" },
        from: createApiBotFrom()
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "客户最后消息是弱收尾");
  assert.equal(decision.lastCustomerMessageText, "好的谢谢");
});

test("平台建联提示不能当成客户真实消息", () => {
  const contact = createContact();
  const normalizedMessages = normalizeConversationMessages([
    createPlatformMessage({
      timestamp: NOW_MS - 2000,
      content: { type: 7, content: "我已经添加了你，现在我们可以开始聊天了。" },
      from: createCustomerFrom()
    }),
    createPlatformMessage({
      timestamp: NOW_MS - 1000,
      content: { type: 7, content: "你好。" },
      from: createCustomerFrom()
    })
  ], contact, replyConfig);

  assert.deepEqual(normalizedMessages.map((message) => message.text), ["你好。"]);
  assert.deepEqual(normalizedMessages.map((message) => message.role), ["customer"]);
});

test("只有平台建联提示时应该显示没有客户消息", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 1600 * 1000,
        content: { type: 7, content: "我已经添加了你，现在我们可以开始聊天了。" },
        from: createCustomerFrom()
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "没有客户消息");
  assert.equal(decision.lastCustomerMessageText, "");
});

test("平台提示过滤应该走配置，未配置的同类文字不能被硬编码排除", () => {
  const contact = createContact();
  const normalizedMessages = normalizeConversationMessages([
    createPlatformMessage({
      timestamp: NOW_MS - 1000,
      content: { type: 7, content: "我已经添加了你，现在我们可以开始聊天了。" },
      from: createCustomerFrom()
    })
  ], contact, {
    ...replyConfig,
    missedReplyPlatformNoticeKeywords: [{ text: "别的固定提示", matchMode: "exact" }]
  });

  assert.deepEqual(normalizedMessages.map((message) => message.text), ["我已经添加了你，现在我们可以开始聊天了。"]);
  assert.deepEqual(normalizedMessages.map((message) => message.role), ["customer"]);
});

test("客户已不是联系人时应该跳过超时和漏回复", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 3000 * 1000,
        content: { type: 7, content: "不带过滤器可以用吗？" },
        from: createCustomerFrom("玉曲霓裳")
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 100 * 1000,
        content: {
          type: 10000,
          content: "你还不是他（她）的联系人。请先发送联系人验证请求，对方验证通过后，才能聊天。 发送联系人验证"
        },
        from: {
          isSelf: false,
          coworker: false,
          contactType: 0,
          displayName: "",
          sendBy: { id: "", name: "" }
        }
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.reason, "客户已不是联系人，无法发送消息");
  assert.equal(decision.isPendingTimeoutReplyCandidate, false);
  assert.equal(decision.isPendingMissedReplyCandidate, false);
  assert.equal(decision.lastCustomerMessageText, "不带过滤器可以用吗？");
  assert.match(decision.recentAgentReplyText, /你还不是他（她）的联系人/);
});

test("客户重新发消息后不应该被旧联系人验证提示跳过", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 5000 * 1000,
        content: { type: 7, content: "不带过滤器可以用吗？" },
        from: createCustomerFrom("玉曲霓裳")
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 4000 * 1000,
        content: {
          type: 10000,
          content: "你还不是他（她）的联系人。请先发送联系人验证请求，对方验证通过后，才能聊天。 发送联系人验证"
        },
        from: {
          isSelf: false,
          coworker: false,
          contactType: 0,
          displayName: "",
          sendBy: { id: "", name: "" }
        }
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 3000 * 1000,
        content: { type: 7, content: "现在可以聊了吗？" },
        from: createCustomerFrom("玉曲霓裳")
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
  assert.equal(decision.lastCustomerMessageText, "现在可以聊了吗？");
});

test("平台 type=6 图片应该作为客户需要处理的附件消息", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 1600 * 1000,
        content: { type: 6, content: "" },
        from: createCustomerFrom()
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
  assert.equal(decision.lastCustomerMessageText, "[图片]");
});

test("平台 type=9 小程序卡片应该标记为小程序且不算客户手打文字", () => {
  const normalizedMessage = normalizeConversationMessage(
    createPlatformMessage({
      timestamp: NOW_MS - 1000,
      content: {
        type: 9,
        title: "广告小程序",
        description: "点击查看活动"
      },
      from: createCustomerFrom()
    }),
    createContact()
  );

  assert.equal(normalizedMessage.role, "customer");
  assert.equal(normalizedMessage.text, "广告小程序");
  assert.equal(normalizedMessage.hasAttachment, true);
  assert.equal(normalizedMessage.isMiniProgramAttachment, true);
  assert.equal(normalizedMessage.hasCustomerWrittenText, false);
});

test("小程序卡片带客户正文时应该保留手打文字", () => {
  const normalizedMessage = normalizeConversationMessage(
    createPlatformMessage({
      timestamp: NOW_MS - 1000,
      content: {
        type: 9,
        text: "这个活动还能用吗",
        title: "活动小程序"
      },
      from: createCustomerFrom()
    }),
    createContact()
  );

  assert.equal(normalizedMessage.text, "这个活动还能用吗");
  assert.equal(normalizedMessage.isMiniProgramAttachment, true);
  assert.equal(normalizedMessage.hasCustomerWrittenText, true);
});

test("标记已读系统事件应该完全退出业务状态", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 3000 * 1000,
        content: { type: 7, content: "我的订单呢" },
        from: createCustomerFrom()
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 100 * 1000,
        content: { type: 10000, content: "郑兰（售后客服）将此对话标为已读" },
        from: {
          isSelf: false,
          coworker: false,
          contactType: 0,
          displayName: "",
          sendBy: { id: "", name: "" }
        }
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
  assert.equal(decision.isPendingTimeoutReplyCandidate, true);
  assert.equal(decision.recentAgentReplyText, "");
  assert.equal(decision.pendingSinceAtMs, NOW_MS - 3000 * 1000);
});

test("空正文payload已读事件也应该完全退出业务状态", () => {
  const decision = analyzeDecision(
    createContact(),
    [
      createPlatformMessage({
        timestamp: NOW_MS - 3000 * 1000,
        content: { type: 7, content: "我的订单呢" },
        from: createCustomerFrom()
      }),
      createPlatformMessage({
        timestamp: NOW_MS - 100 * 1000,
        content: {
          type: 10000,
          payload: {
            type: 1,
            subPayload: {
              opUser: {
                userId: "698047a80e5aff4949933b7f",
                username: "卢安（售后客服）"
              }
            }
          },
          content: ""
        },
        from: {
          isSelf: false,
          coworker: false,
          contactType: 0,
          displayName: "",
          sendBy: { id: "", name: "" }
        }
      })
    ],
    NOW_MS
  );

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.reminderKind, "missedReply");
  assert.equal(decision.reasonLabel, "客户消息后无人实质回复");
  assert.equal(decision.isPendingTimeoutReplyCandidate, true);
  assert.equal(decision.recentAgentReplyText, "");
  assert.equal(decision.pendingSinceAtMs, NOW_MS - 3000 * 1000);
});

test("单条真实平台消息应该保留最后有效消息展示需要的发送方和内容", () => {
  const normalizedMessage = normalizeConversationMessage(
    createPlatformMessage({
      timestamp: NOW_MS - 1000,
      content: { type: 7, content: "你好。" },
      from: createCustomerFrom()
    }),
    createContact()
  );

  assert.equal(normalizedMessage.role, "customer");
  assert.equal(normalizedMessage.senderName, "刘利军");
  assert.equal(normalizedMessage.senderUserId, "");
  assert.equal(normalizedMessage.text, "你好。");
  assert.equal(normalizedMessage.hasAttachment, false);
});
