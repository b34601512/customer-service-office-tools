const test = require("node:test");
const assert = require("node:assert/strict");

const {
  listPendingTransferVerifications,
  recordPendingTransferVerification,
  resetPendingTransferVerifications,
  settlePendingTransferVerifications
} = require("../../src/features/transferMonitor/autoTransferVerificationStore");

const baseEntry = {
  chatId: "chat-1",
  customerName: "客户甲",
  sourceStaffName: "刘秀文",
  targetStaffName: "叶炳辉",
  targetUserId: "pre-ye",
  reminderKind: "timeout"
};

test.beforeEach(() => {
  resetPendingTransferVerifications();
});

test("联系人快照改口到目标客服才算转接成功", () => {
  recordPendingTransferVerification(baseEntry);
  assert.equal(listPendingTransferVerifications().length, 1);

  const pending = settlePendingTransferVerifications([
    { chatId: "chat-1", assignedToUserId: "pre-ye", customerName: "客户甲" }
  ]);

  assert.equal(pending.verified.length, 1);
  assert.equal(pending.verified[0].targetStaffName, "叶炳辉");
  assert.equal(pending.failed.length, 0);
  assert.equal(pending.waiting.length, 0);
  assert.equal(listPendingTransferVerifications().length, 0);
});

test("还没到超时时间时继续等待，不提前判失败", () => {
  const entry = recordPendingTransferVerification({ ...baseEntry, timeoutMs: 30000 });
  const pending = settlePendingTransferVerifications(
    [{ chatId: "chat-1", assignedToUserId: "pre-liu" }],
    { nowMs: entry.recordAtMs + 5000 }
  );

  assert.equal(pending.verified.length, 0);
  assert.equal(pending.failed.length, 0);
  assert.equal(pending.waiting.length, 1);
  assert.equal(listPendingTransferVerifications().length, 1);
});

test("超过等待时间仍是原客服时判失败并给出原因", () => {
  const entry = recordPendingTransferVerification({ ...baseEntry, timeoutMs: 30000 });
  const pending = settlePendingTransferVerifications(
    [{ chatId: "chat-1", assignedToUserId: "pre-liu" }],
    { nowMs: entry.recordAtMs + 31000 }
  );

  assert.equal(pending.failed.length, 1);
  assert.equal(pending.failed[0].reason, "assignment_unchanged");
  assert.equal(listPendingTransferVerifications().length, 0);
});

test("快照里找不到该客户时按未核实处理，不能算成功", () => {
  const entry = recordPendingTransferVerification({ ...baseEntry, timeoutMs: 30000 });
  const pending = settlePendingTransferVerifications(
    [{ chatId: "chat-other", assignedToUserId: "pre-ye" }],
    { nowMs: entry.recordAtMs + 31000 }
  );

  assert.equal(pending.verified.length, 0);
  assert.equal(pending.failed[0].reason, "chat_not_found_in_snapshot");
});

test("同一客户重复登记只保留最新一条", () => {
  recordPendingTransferVerification(baseEntry);
  recordPendingTransferVerification({ ...baseEntry, targetUserId: "pre-han", targetStaffName: "韩欢欢" });

  const pendingList = listPendingTransferVerifications();
  assert.equal(pendingList.length, 1);
  assert.equal(pendingList[0].targetUserId, "pre-han");
});
