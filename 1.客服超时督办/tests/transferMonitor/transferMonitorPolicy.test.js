const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTransferContactState,
  buildTransferReminderEventKey,
  detectTransferCandidates,
  isTransferTimestampWithinToday
} = require("../../src/features/transferMonitor/transferMonitorPolicy");

function createLocalTimestamp(year, month, day, hours, minutes, seconds, milliseconds = 0) {
  return new Date(year, month - 1, day, hours, minutes, seconds, milliseconds).getTime();
}

function createContact(overrides = {}) {
  return {
    chatId: "chat_1",
    customerName: "罗马假日",
    previewText: "【小程序】",
    assignedToUserId: "user_a",
    lastAssignedTimestamp: 1776309733305,
    ...overrides
  };
}

test("首次看到已有分配的客户时应该只建立基线不提醒", () => {
  const nowTimestamp = createLocalTimestamp(2026, 4, 15, 10, 0, 0);
  const result = detectTransferCandidates(
    {},
    [
      createContact({
        lastAssignedTimestamp: createLocalTimestamp(2026, 4, 15, 9, 8, 53, 305)
      })
    ],
    { nowTimestamp }
  );

  assert.equal(result.candidates.length, 0);
  assert.equal(result.skippedHistoricalCandidates, 0);
  assert.deepEqual(
    result.currentStateMap.chat_1,
    buildTransferContactState(
      createContact({
        lastAssignedTimestamp: createLocalTimestamp(2026, 4, 15, 9, 8, 53, 305)
      })
    )
  );
});

test("系统首次分配客服时不应该生成提醒候选", () => {
  const nowTimestamp = createLocalTimestamp(2026, 4, 15, 10, 0, 0);
  const result = detectTransferCandidates(
    {
      chat_1: buildTransferContactState(
        createContact({
          assignedToUserId: "",
          lastAssignedTimestamp: 0
        })
      )
    },
    [
      createContact({
        assignedToUserId: "user_new",
        lastAssignedTimestamp: createLocalTimestamp(2026, 4, 15, 9, 8, 53, 305)
      })
    ],
    { nowTimestamp }
  );

  assert.equal(result.candidates.length, 0);
  assert.equal(result.skippedHistoricalCandidates, 0);
});

test("A客服转给B客服时应该生成转接候选", () => {
  const nowTimestamp = createLocalTimestamp(2026, 4, 15, 10, 0, 0);
  const result = detectTransferCandidates(
    {
      chat_1: buildTransferContactState(
        createContact({
          assignedToUserId: "user_old",
          lastAssignedTimestamp: createLocalTimestamp(2026, 4, 15, 9, 8, 20)
        })
      )
    },
    [
      createContact({
        assignedToUserId: "user_new",
        lastAssignedTimestamp: createLocalTimestamp(2026, 4, 15, 9, 8, 53, 305)
      })
    ],
    { nowTimestamp }
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.skippedHistoricalCandidates, 0);
  assert.equal(result.candidates[0].actionLabel, "转接");
  assert.equal(result.candidates[0].previousAssignedToUserId, "user_old");
  assert.equal(
    result.candidates[0].transferReminderEventKey,
    buildTransferReminderEventKey({
      chatId: "chat_1",
      lastAssignedTimestamp: createLocalTimestamp(2026, 4, 15, 9, 8, 53, 305),
      assignedToUserId: "user_new"
    })
  );
});

test("同一个客服被系统重复分配时不应该生成提醒候选", () => {
  const nowTimestamp = createLocalTimestamp(2026, 4, 15, 10, 0, 0);
  const result = detectTransferCandidates(
    {
      chat_1: buildTransferContactState(
        createContact({
          assignedToUserId: "user_a",
          lastAssignedTimestamp: createLocalTimestamp(2026, 4, 15, 9, 8, 20)
        })
      )
    },
    [
      createContact({
        assignedToUserId: "user_a",
        lastAssignedTimestamp: createLocalTimestamp(2026, 4, 15, 9, 8, 53, 305)
      })
    ],
    { nowTimestamp }
  );

  assert.equal(result.candidates.length, 0);
  assert.equal(result.skippedHistoricalCandidates, 0);
});

test("昨天的转接即使今天重新扫到也不应该生成提醒候选", () => {
  const nowTimestamp = createLocalTimestamp(2026, 4, 23, 10, 30, 0);
  const result = detectTransferCandidates(
    {
      chat_1: buildTransferContactState(
        createContact({
          assignedToUserId: "user_old",
          lastAssignedTimestamp: createLocalTimestamp(2026, 4, 22, 23, 29, 0)
        })
      )
    },
    [
      createContact({
        assignedToUserId: "user_new",
        lastAssignedTimestamp: createLocalTimestamp(2026, 4, 22, 23, 31, 22)
      })
    ],
    { nowTimestamp }
  );

  assert.equal(result.candidates.length, 0);
  assert.equal(result.skippedHistoricalCandidates, 1);
});

test("今天零点后的转接应该允许进入提醒候选", () => {
  const nowTimestamp = createLocalTimestamp(2026, 4, 23, 10, 30, 0);

  assert.equal(
    isTransferTimestampWithinToday(
      createLocalTimestamp(2026, 4, 23, 0, 0, 1),
      nowTimestamp
    ),
    true
  );
  assert.equal(
    isTransferTimestampWithinToday(
      createLocalTimestamp(2026, 4, 22, 23, 59, 59, 999),
      nowTimestamp
    ),
    false
  );
});

test("分配状态没变化时不应该重复生成候选", () => {
  const state = buildTransferContactState(createContact());
  const result = detectTransferCandidates(
    {
      chat_1: state
    },
    [createContact()]
  );

  assert.equal(result.candidates.length, 0);
});
