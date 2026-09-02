const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decideTransferCandidateSource
} = require("../../src/features/transferMonitor/transferEventVerifier");

function createCandidate(overrides = {}) {
  return {
    chatId: "chat_1",
    customerName: "圈圈呀",
    assignedToUserId: "user_new",
    lastAssignedTimestamp: 1776651459032,
    ...overrides
  };
}

function createTransferMessage(overrides = {}) {
  const payloadType = overrides.payloadType ?? 3;
  const timestamp = overrides.timestamp ?? 1776651459036;
  const assigneeUser = overrides.assigneeUser === undefined
    ? {
        userId: "user_new",
        username: "郑兰（售后客服）"
      }
    : overrides.assigneeUser;
  const opUser = overrides.opUser === undefined
    ? null
    : overrides.opUser;

  const subPayload = {};
  if (opUser) {
    subPayload.opUser = opUser;
  }
  if (assigneeUser) {
    subPayload.assigneeUser = assigneeUser;
  }

  return {
    id: overrides.id || `msg_${payloadType}_${timestamp}`,
    timestamp,
    content: {
      type: 10000,
      payload: {
        type: payloadType,
        subPayload
      },
      content: ""
    }
  };
}

test("系统分配事件不应该触发转接提醒", () => {
  const decision = decideTransferCandidateSource(createCandidate(), [
    createTransferMessage({
      payloadType: 3
    })
  ]);

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.sourceLabel, "系统分配");
});

test("人工转给另一位客服时应该触发转接提醒", () => {
  const decision = decideTransferCandidateSource(createCandidate(), [
    createTransferMessage({
      payloadType: 0,
      opUser: {
        userId: "user_old",
        username: "易凡（售前客服）"
      }
    })
  ]);

  assert.equal(decision.shouldRemind, true);
  assert.equal(decision.sourceLabel, "人工转接");
  assert.equal(decision.matchedEvent.opUserId, "user_old");
  assert.equal(decision.matchedEvent.assigneeUserId, "user_new");
});

test("同一个人操作并指向自己时不应该触发提醒", () => {
  const decision = decideTransferCandidateSource(createCandidate(), [
    createTransferMessage({
      payloadType: 0,
      opUser: {
        userId: "user_new",
        username: "郑兰（售后客服）"
      }
    })
  ]);

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.sourceLabel, "同人操作");
});

test("旧人工转接事件不应该盖过本次系统分配", () => {
  const decision = decideTransferCandidateSource(createCandidate(), [
    createTransferMessage({
      id: "old_manual",
      payloadType: 0,
      timestamp: 1776651400000,
      opUser: {
        userId: "user_old",
        username: "易凡（售前客服）"
      }
    }),
    createTransferMessage({
      id: "current_system",
      payloadType: 3,
      timestamp: 1776651459036
    })
  ]);

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.sourceLabel, "系统分配");
  assert.equal(decision.matchedEvent.messageId, "current_system");
});

test("找不到与本次分配时间对齐的事件时不应该提醒", () => {
  const decision = decideTransferCandidateSource(createCandidate(), [
    createTransferMessage({
      payloadType: 0,
      timestamp: 1776651000000,
      opUser: {
        userId: "user_old",
        username: "易凡（售前客服）"
      }
    })
  ]);

  assert.equal(decision.shouldRemind, false);
  assert.equal(decision.sourceLabel, "未匹配事件");
});
