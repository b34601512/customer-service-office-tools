const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const appConfig = require("../../src/config/appConfig");
const {
  buildEmptyMissedReplyMonitorState,
  clearResolvedMissedReplyState,
  clearUnresolvedReplyCountdownItem,
  clearUnresolvedReplyDecisionItem,
  clearUnresolvedReplyReminderSnapshot,
  markUnresolvedReplyReminderSent,
  readMissedReplyMonitorState,
  shouldSendUnresolvedReplyReminder,
  setUnresolvedReplyCountdownItem,
  setUnresolvedReplyDecisionItem,
  setUnresolvedReplyReminderSnapshot,
  writeMissedReplyMonitorState
} = require("../../src/features/missedReplyMonitor/missedReplyStateStore");
const {
  attachContactListIndexes,
  selectContactsForMissedReplyScan
} = require("../../src/features/missedReplyMonitor/missedReplyWorkflow/contactScan");
const {
  mergeRetainedPendingContacts,
  pruneMissingResolvedDecisionItems
} = require("../../src/features/missedReplyMonitor/missedReplyWorkflow/contactRetention");

const originalStatePath = appConfig.missedReplyMonitorStatePath;

function createCandidate(overrides = {}) {
  return {
    chatId: "chat_1",
    customerName: "罗马假日",
    lastCustomerMessageAtMs: 1800000000000,
    pendingSinceAtMs: 1800000000000,
    reminderKind: "timeout",
    ...overrides
  };
}

test("同一条客户消息首次超时只提醒一次，漏回复还能再提醒一次", () => {
  const state = buildEmptyMissedReplyMonitorState();
  const timeoutCandidate = createCandidate({ reminderKind: "timeout" });
  const missedReplyCandidate = createCandidate({ reminderKind: "missedReply" });

  assert.equal(shouldSendUnresolvedReplyReminder(state, timeoutCandidate), true);
  markUnresolvedReplyReminderSent(state, timeoutCandidate, 1800000150000);
  assert.equal(shouldSendUnresolvedReplyReminder(state, timeoutCandidate), false);
  assert.equal(shouldSendUnresolvedReplyReminder(state, missedReplyCandidate), true);
  markUnresolvedReplyReminderSent(state, missedReplyCandidate, 1800001500000);
  assert.equal(shouldSendUnresolvedReplyReminder(state, missedReplyCandidate), false);
});

test("同一待回复责任内客户追问不会重新开启提醒", () => {
  const state = buildEmptyMissedReplyMonitorState();
  markUnresolvedReplyReminderSent(
    state,
    createCandidate({ reminderKind: "missedReply" }),
    1800001500000
  );

  assert.equal(
    shouldSendUnresolvedReplyReminder(
      state,
      createCandidate({
        lastCustomerMessageAtMs: 1800000200000,
        pendingSinceAtMs: 1800000000000,
        reminderKind: "missedReply"
      })
    ),
    false
  );
});

test("人工实质回复后的新责任会重新开启两段提醒", () => {
  const state = buildEmptyMissedReplyMonitorState();
  markUnresolvedReplyReminderSent(
    state,
    createCandidate({ reminderKind: "missedReply" }),
    1800001500000
  );

  assert.equal(
    shouldSendUnresolvedReplyReminder(
      state,
      createCandidate({
        lastCustomerMessageAtMs: 1800000200000,
        pendingSinceAtMs: 1800000200000,
        reminderKind: "timeout"
      })
    ),
    true
  );
});

test("临时回复不会把同一条客户消息变成新事件", () => {
  const state = buildEmptyMissedReplyMonitorState();
  markUnresolvedReplyReminderSent(
    state,
    createCandidate({ reminderKind: "timeout" }),
    1800000150000
  );

  assert.equal(
    shouldSendUnresolvedReplyReminder(
      state,
      createCandidate({
        pendingSinceAtMs: 1800000000000,
        reminderKind: "timeout"
      })
    ),
    false
  );
});

test("人工实质回复后应该清掉旧提醒状态", () => {
  const state = buildEmptyMissedReplyMonitorState();
  markUnresolvedReplyReminderSent(
    state,
    createCandidate({ reminderKind: "missedReply" }),
    1800001500000
  );

  assert.equal(clearResolvedMissedReplyState(state, "chat_1"), true);
  assert.deepEqual(state.reminderEventsByChatId, {});
});

test("人工实质回复后应该保留最近提醒复盘快照", () => {
  const state = buildEmptyMissedReplyMonitorState();
  markUnresolvedReplyReminderSent(
    state,
    createCandidate({ reminderKind: "timeout" }),
    1800000150000
  );
  setUnresolvedReplyReminderSnapshot(state, {
    chatId: "chat_1",
    customerName: "罗马假日",
    reminderKind: "timeout",
    reminderSentAtMs: 1800000150000,
    reasonLabel: "客户消息后无人实质回复",
    pendingDurationSeconds: 150,
    assignedToUserId: "",
    assignmentStatus: "unassigned",
    assignmentStatusLabel: "当前会话未分配客服",
    lastCustomerMessageText: "帮我查一下"
  });

  assert.equal(clearResolvedMissedReplyState(state, "chat_1"), true);
  assert.deepEqual(state.reminderEventsByChatId, {});
  assert.equal(state.reminderSnapshotsByChatId.chat_1.reasonLabel, "客户消息后无人实质回复");
  assert.equal(clearUnresolvedReplyReminderSnapshot(state, "chat_1"), true);
  assert.deepEqual(state.reminderSnapshotsByChatId, {});
});

test("旧轮次状态读入后应该迁移成两段提醒事件", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "missed-reply-state-"));
  appConfig.missedReplyMonitorStatePath = path.join(tempDir, "state.json");

  try {
    fs.writeFileSync(appConfig.missedReplyMonitorStatePath, JSON.stringify({
      timeoutRemindersByChatId: {
        chat_1: {
          customerName: "罗马假日",
          lastCustomerMessageAtMs: 1800000000000,
          pendingSinceAtMs: 1800000000000,
          lastReminderAtMs: 1800000150000
        }
      },
      remindersByChatId: {
        chat_1: {
          customerName: "罗马假日",
          lastCustomerMessageAtMs: 1800000000000,
          pendingSinceAtMs: 1800000000000,
          lastReminderAtMs: 1800001500000
        }
      }
    }, null, 2), "utf8");

    const state = readMissedReplyMonitorState();
    assert.equal(state.reminderEventsByChatId.chat_1.customerName, "罗马假日");
    assert.equal(state.reminderEventsByChatId.chat_1.timeoutReminderSentAtMs, 1800000150000);
    assert.equal(state.reminderEventsByChatId.chat_1.missedReplyReminderSentAtMs, 1800001500000);
    assert.equal("remindersByChatId" in state, false);
  } finally {
    appConfig.missedReplyMonitorStatePath = originalStatePath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("未实质回复倒计时快照应该能落盘、读回和清理", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "missed-reply-countdown-"));
  appConfig.missedReplyMonitorStatePath = path.join(tempDir, "state.json");

  try {
    const state = buildEmptyMissedReplyMonitorState();
    setUnresolvedReplyCountdownItem(state, {
      chatId: "chat_1",
      customerName: "罗马假日",
      lastCustomerMessageAtMs: 1800000000000,
      lastCustomerMessageText: "还没处理吗",
      pendingSinceAtMs: 1800000000000,
      pendingDurationSeconds: 100,
      nextReminderKind: "timeout",
      nextReminderAtMs: 1800000150000,
      timeoutReminderTargetAtMs: 1800000150000,
      missedReplyReminderTargetAtMs: 1800001500000,
      reasonLabel: "客户消息后无人实质回复",
      scannedAtMs: 1800000100000
    });
    writeMissedReplyMonitorState(state);

    const persistedState = readMissedReplyMonitorState();
    assert.equal(persistedState.countdownItemsByChatId.chat_1.customerName, "罗马假日");
    assert.equal(persistedState.countdownItemsByChatId.chat_1.nextReminderKind, "timeout");
    assert.equal(persistedState.countdownItemsByChatId.chat_1.nextReminderAtMs, 1800000150000);
    assert.equal(clearUnresolvedReplyCountdownItem(persistedState, "chat_1"), true);
    assert.deepEqual(persistedState.countdownItemsByChatId, {});
  } finally {
    appConfig.missedReplyMonitorStatePath = originalStatePath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("未实质回复判定原因应该能落盘、读回和清理", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "missed-reply-decision-"));
  appConfig.missedReplyMonitorStatePath = path.join(tempDir, "state.json");

  try {
    const state = buildEmptyMissedReplyMonitorState();
    setUnresolvedReplyDecisionItem(state, {
      chatId: "chat_1",
      customerName: "罗马假日",
      contactListIndex: 3,
      previewText: "谢谢",
      statusLabel: "未进入漏回复",
      decisionReason: "客户最后消息是弱收尾",
      latestMessageRole: "customer",
      latestMessageSenderName: "罗马假日",
      latestMessageText: "谢谢",
      latestMessageAtMs: 1800000000000,
      lastCustomerMessageText: "谢谢",
      pendingDurationSeconds: 120,
      nextReminderKind: "timeout",
      nextReminderAtMs: 1800000150000,
      scannedAtMs: 1800000100000
    });
    writeMissedReplyMonitorState(state);

    const persistedState = readMissedReplyMonitorState();
    assert.equal(persistedState.decisionItemsByChatId.chat_1.contactListIndex, 3);
    assert.equal(persistedState.decisionItemsByChatId.chat_1.previewText, "谢谢");
    assert.equal(persistedState.decisionItemsByChatId.chat_1.decisionReason, "客户最后消息是弱收尾");
    assert.equal(persistedState.decisionItemsByChatId.chat_1.latestMessageRole, "customer");
    assert.equal(persistedState.decisionItemsByChatId.chat_1.latestMessageSenderName, "罗马假日");
    assert.equal(persistedState.decisionItemsByChatId.chat_1.latestMessageText, "谢谢");
    assert.equal(persistedState.decisionItemsByChatId.chat_1.latestMessageAtMs, 1800000000000);
    assert.equal(persistedState.decisionItemsByChatId.chat_1.nextReminderKind, "timeout");
    assert.equal(clearUnresolvedReplyDecisionItem(persistedState, "chat_1"), true);
    assert.deepEqual(persistedState.decisionItemsByChatId, {});
  } finally {
    appConfig.missedReplyMonitorStatePath = originalStatePath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("未实质回复提醒复盘快照应该能落盘和读回", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "missed-reply-reminder-snapshot-"));
  appConfig.missedReplyMonitorStatePath = path.join(tempDir, "state.json");

  try {
    const state = buildEmptyMissedReplyMonitorState();
    setUnresolvedReplyReminderSnapshot(state, {
      chatId: "chat_1",
      customerName: "罗马假日",
      reminderKind: "timeout",
      reminderSentAtMs: 1800000150000,
      reasonLabel: "客户消息后无人实质回复",
      pendingDurationSeconds: 150,
      assignedToUserId: "staff_a",
      assignmentStatus: "assigned",
      assignmentStatusLabel: "当前会话已分配客服",
      assigneeName: "客服A",
      assigneeRoleLabel: "售后客服",
      lastCustomerMessageAtMs: 1800000000000,
      lastCustomerMessageText: "帮我查一下",
      recentAgentReplyText: "",
      dispatchTarget: "客服A + 黎路遥",
      webhookName: "测试群"
    });
    writeMissedReplyMonitorState(state);

    const persistedState = readMissedReplyMonitorState();
    assert.equal(persistedState.reminderSnapshotsByChatId.chat_1.customerName, "罗马假日");
    assert.equal(persistedState.reminderSnapshotsByChatId.chat_1.reminderKind, "timeout");
    assert.equal(persistedState.reminderSnapshotsByChatId.chat_1.assignmentStatus, "assigned");
    assert.equal(persistedState.reminderSnapshotsByChatId.chat_1.assignmentStatusLabel, "当前会话已分配客服");
    assert.equal(persistedState.reminderSnapshotsByChatId.chat_1.dispatchTarget, "客服A + 黎路遥");
  } finally {
    appConfig.missedReplyMonitorStatePath = originalStatePath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("未实质回复监控应该给联系人补上列表顺序，方便控制台镜像客户列表", () => {
  const contacts = attachContactListIndexes([
    { chatId: "chat_1", customerName: "客户1" },
    { chatId: "chat_2", customerName: "客户2" }
  ]);

  assert.equal(contacts[0].contactListIndex, 1);
  assert.equal(contacts[1].contactListIndex, 2);
});

test("未实质回复监控应该按小批轮转扫描联系人，避免一轮读取全部消息", () => {
  const runtimeState = {
    nextContactStartIndex: 0
  };
  const contacts = Array.from({ length: 5 }, (_, index) => ({
    chatId: `chat_${index + 1}`
  }));

  assert.deepEqual(
    selectContactsForMissedReplyScan(runtimeState, contacts, 2).map((contact) => contact.chatId),
    ["chat_1", "chat_2"]
  );
  assert.deepEqual(
    selectContactsForMissedReplyScan(runtimeState, contacts, 2).map((contact) => contact.chatId),
    ["chat_3", "chat_4"]
  );
  assert.deepEqual(
    selectContactsForMissedReplyScan(runtimeState, contacts, 2).map((contact) => contact.chatId),
    ["chat_5", "chat_1"]
  );
});

test("离开联系人快照的未解决责任应该保留为待核验索引", () => {
  const runtimeState = buildEmptyMissedReplyMonitorState();
  runtimeState.decisionItemsByChatId.chat_pending = {
    chatId: "chat_pending",
    customerName: "待核验客户",
    assignedToUserId: "old_staff",
    lastCustomerMessageText: "还没处理吗",
    isPendingMissedReplyCandidate: true
  };
  runtimeState.decisionItemsByChatId.chat_resolved = {
    chatId: "chat_resolved",
    customerName: "已解决客户",
    isPendingMissedReplyCandidate: false
  };

  const contacts = mergeRetainedPendingContacts(runtimeState, [
    { chatId: "chat_current", customerName: "当前客户", assignedToUserId: "staff_a" }
  ]);
  pruneMissingResolvedDecisionItems(runtimeState, contacts);

  assert.deepEqual(contacts.map((item) => item.chatId), ["chat_current", "chat_pending"]);
  assert.equal(contacts[1].assignedToUserId, "");
  assert.equal(contacts[1].retainedPendingContact, true);
  assert.equal("chat_pending" in runtimeState.decisionItemsByChatId, true);
  assert.equal("chat_resolved" in runtimeState.decisionItemsByChatId, false);
});
