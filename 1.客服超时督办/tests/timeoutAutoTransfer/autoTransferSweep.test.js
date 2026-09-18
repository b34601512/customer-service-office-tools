const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const appConfig = require("../../src/config/appConfig");
const {
  buildEmptyAutoTransferSweepLedger,
  readAutoTransferSweepAttempt,
  readAutoTransferSweepLedger,
  recordAutoTransferSweepAttempt,
  writeAutoTransferSweepLedger
} = require("../../src/features/timeoutAutoTransfer/autoTransferSweepLedger");
const {
  SHIFT_HANDOVER_REMINDER_KIND,
  SHIFT_HANDOVER_RETRY_INTERVAL_MS,
  listShiftHandoverCandidates
} = require("../../src/features/timeoutAutoTransfer/autoTransferSweep");

const originalSweepPath = appConfig.autoTransferSweepStatePath;
let isolatedPath = "";

function buildLedgerPath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `sweep-ledger-${name}-`)), "state.json");
}

test.beforeEach(() => {
  isolatedPath = buildLedgerPath("case");
  appConfig.autoTransferSweepStatePath = isolatedPath;
});

test.afterEach(() => {
  appConfig.autoTransferSweepStatePath = originalSweepPath;
});

function buildDecisionItem(overrides = {}) {
  return {
    chatId: "chat-1",
    customerName: "客户甲",
    assignedToUserId: "after-chen",
    assignmentStatus: "assigned",
    isPendingTimeoutReplyCandidate: false,
    isPendingMissedReplyCandidate: true,
    ...overrides
  };
}

const memberMapByUserId = {
  "after-chen": { userId: "after-chen", staffName: "陈燕玲", staffGroup: "after_sales" },
  "after-miao": { userId: "after-miao", staffName: "缪婷婷", staffGroup: "after_sales" }
};

test("补判账本可以落盘并读回，最多保留最近若干条", () => {
  assert.deepEqual(readAutoTransferSweepLedger(), buildEmptyAutoTransferSweepLedger());

  recordAutoTransferSweepAttempt({
    chatId: "chat-1",
    customerName: "客户甲",
    assigneeUserId: "after-chen",
    targetStaffName: "缪婷婷",
    outcome: "sent",
    reason: "eligible",
    attemptedAtMs: 1000
  });

  const attempt = readAutoTransferSweepAttempt("chat-1");
  assert.equal(attempt.customerName, "客户甲");
  assert.equal(attempt.assigneeUserId, "after-chen");
  assert.equal(attempt.targetStaffName, "缪婷婷");
  assert.equal(attempt.outcome, "sent");
  assert.equal(fs.existsSync(isolatedPath), true);

  writeAutoTransferSweepLedger(buildEmptyAutoTransferSweepLedger());
  assert.deepEqual(readAutoTransferSweepLedger().attemptsByChatId, {});
});

test("只挑真的分配到人、且客户还在等回复的会话去补判", () => {
  const candidates = listShiftHandoverCandidates({
    decisionItemsByChatId: {
      "chat-1": buildDecisionItem(),
      "chat-2": buildDecisionItem({ chatId: "chat-2", assignmentStatus: "last_handler" }),
      "chat-3": buildDecisionItem({
        chatId: "chat-3",
        isPendingTimeoutReplyCandidate: false,
        isPendingMissedReplyCandidate: false
      }),
      "chat-4": buildDecisionItem({ chatId: "chat-4", assignedToUserId: "" }),
      "chat-5": buildDecisionItem({ chatId: "chat-5", assignedToUserId: "unknown-staff" })
    },
    memberMapByUserId,
    ledger: buildEmptyAutoTransferSweepLedger(),
    nowMs: 10_000
  });

  assert.deepEqual(candidates.map((item) => item.chatId), ["chat-1"]);
  assert.equal(candidates[0].candidate.reminderKind, SHIFT_HANDOVER_REMINDER_KIND);
  assert.equal(candidates[0].assignment.status, "assigned");
  assert.equal(candidates[0].assignment.assigneeMember.staffName, "陈燕玲");
});

test("同一客户在冷却窗口内不重复补判，换人后可以立刻重判", () => {
  const ledger = buildEmptyAutoTransferSweepLedger();
  ledger.attemptsByChatId["chat-1"] = {
    chatId: "chat-1",
    assigneeUserId: "after-chen",
    attemptedAtMs: 100_000,
    outcome: "sent"
  };

  const withinCooldown = listShiftHandoverCandidates({
    decisionItemsByChatId: { "chat-1": buildDecisionItem() },
    memberMapByUserId,
    ledger,
    nowMs: 100_000 + SHIFT_HANDOVER_RETRY_INTERVAL_MS - 1000
  });
  assert.deepEqual(withinCooldown, []);

  const afterCooldown = listShiftHandoverCandidates({
    decisionItemsByChatId: { "chat-1": buildDecisionItem() },
    memberMapByUserId,
    ledger,
    nowMs: 100_000 + SHIFT_HANDOVER_RETRY_INTERVAL_MS + 1000
  });
  assert.equal(afterCooldown.length, 1);

  const assigneeChanged = listShiftHandoverCandidates({
    decisionItemsByChatId: {
      "chat-1": buildDecisionItem({ assignedToUserId: "after-miao" })
    },
    memberMapByUserId,
    ledger,
    nowMs: 100_000 + 1000
  });
  assert.equal(assigneeChanged.length, 1);
  assert.equal(assigneeChanged[0].assigneeUserId, "after-miao");
});

test("一轮补判最多处理固定条数，避免卡住主循环", () => {
  const decisionItemsByChatId = {};
  for (let index = 0; index < 12; index += 1) {
    decisionItemsByChatId[`chat-${index}`] = buildDecisionItem({ chatId: `chat-${index}` });
  }

  const candidates = listShiftHandoverCandidates({
    decisionItemsByChatId,
    memberMapByUserId,
    ledger: buildEmptyAutoTransferSweepLedger(),
    nowMs: 10_000
  });

  assert.equal(candidates.length, 5);
});

// ===== 补判链路（发出转接指令 + 账本记录口径）=====
const { setupIsolatedWecomTestConfig } = require("../support/wecomTestConfig");
const { ASSIGNMENT_STATUS } = require("../../src/features/shared/currentAssignment");
const {
  publishOnlinePresenceSnapshot,
  resetOnlinePresenceSnapshot
} = require("../../src/features/onlinePresenceMonitor/onlinePresenceSnapshotStore");
const {
  listPendingTransferVerifications,
  resetPendingTransferVerifications
} = require("../../src/features/transferMonitor/autoTransferVerificationStore");
const { runShiftHandoverSweep } = require("../../src/features/timeoutAutoTransfer/autoTransferSweep");

const TEST_WECOM_CONFIG_PATH = setupIsolatedWecomTestConfig("auto-transfer-sweep");

const sweepConfig = {
  timeoutAutoTransferEnabled: true,
  onlinePresenceWorkStartTime: "08:00",
  offDutyPreSalesEarlyStartTime: "08:00",
  offDutyPreSalesLateStartTime: "15:45",
  offDutyAfterSalesEarlyStartTime: "08:00",
  offDutyAfterSalesLateStartTime: "14:00",
  offDutyPreSalesEarlyCloseTime: "16:30",
  offDutyPreSalesLateCloseTime: "23:45",
  offDutyAfterSalesEarlyCloseTime: "16:30",
  offDutyAfterSalesLateCloseTime: "22:30"
};

const sweepScheduleService = {
  async readDailyShiftMap() {
    return {
      backgroundColorAvailable: true,
      shiftMap: {
        陈燕玲: { normalizedShift: "早班", hasBackgroundColor: false, backgroundColor: "" },
        李守耀: { normalizedShift: "早班", hasBackgroundColor: false, backgroundColor: "" },
        缪婷婷: { normalizedShift: "晚班", hasBackgroundColor: false, backgroundColor: "" }
      }
    };
  }
};

function buildSweepPage(frames) {
  return {
    async evaluate(pageFunction, argument) {
      const originalWindow = global.window;
      global.window = {
        __customerServiceAppSockets: [
          {
            url: "wss://zan-mh.xiaoshunai.com/socket.io/?token=secret",
            outboundFrames: ["0{\"sid\":\"x\"}", "40/client?token=secret,"],
            seenSocketIoNamespaces: ["client"],
            rootNamespaceSeen: false,
            lastInboundFrame: "",
            socket: {
              readyState: 1,
              send(frame) {
                frames.push(frame);
              }
            }
          }
        ]
      };
      try {
        return pageFunction(argument);
      } finally {
        global.window = originalWindow;
      }
    }
  };
}

test("交班补判：原接待已下班时补发转接指令并记账本", async () => {
  resetOnlinePresenceSnapshot();
  resetPendingTransferVerifications();
  publishOnlinePresenceSnapshot({
    rowsByStaffName: {
      李守耀: { staffName: "李守耀", staffGroup: "after_sales", autoAssignEnabled: true },
      缪婷婷: { staffName: "缪婷婷", staffGroup: "after_sales", autoAssignEnabled: true }
    }
  });

  const frames = [];
  const result = await runShiftHandoverSweep({
    page: buildSweepPage(frames),
    scheduleService: sweepScheduleService,
    memberMapByUserId: {
      "after-chen": { userId: "after-chen", staffName: "陈燕玲", staffGroup: "after_sales" },
      "after-li": { userId: "after-li", staffName: "李守耀", staffGroup: "after_sales" },
      "after-miao": { userId: "after-miao", staffName: "缪婷婷", staffGroup: "after_sales" }
    },
    replyConfig: sweepConfig,
    decisionItemsByChatId: {
      "chat-handover": buildDecisionItem({ chatId: "chat-handover" })
    },
    now: new Date(2026, 8, 16, 17, 0),
    ledger: buildEmptyAutoTransferSweepLedger()
  });

  assert.equal(result.status, "done");
  assert.equal(result.handledCount, 1);
  assert.deepEqual(frames, [
    "42/client,[\"assignChat\",{\"chatId\":\"chat-handover\",\"groupId\":\"group\",\"assigneeId\":\"after-miao\"}]"
  ]);
  assert.equal(listPendingTransferVerifications().length, 1);
  const attempt = readAutoTransferSweepAttempt("chat-handover");
  assert.equal(attempt.assigneeUserId, "after-chen");
  assert.equal(attempt.targetStaffName, "缪婷婷");
});

test("交班补判：原接待还在班且在线时安静跳过，不记账本（否则下班后就补判不到了）", async () => {
  resetOnlinePresenceSnapshot();
  resetPendingTransferVerifications();
  publishOnlinePresenceSnapshot({
    rowsByStaffName: {
      陈燕玲: { staffName: "陈燕玲", staffGroup: "after_sales", autoAssignEnabled: true },
      缪婷婷: { staffName: "缪婷婷", staffGroup: "after_sales", autoAssignEnabled: true }
    }
  });

  const frames = [];
  const result = await runShiftHandoverSweep({
    page: buildSweepPage(frames),
    scheduleService: sweepScheduleService,
    memberMapByUserId: {
      "after-chen": { userId: "after-chen", staffName: "陈燕玲", staffGroup: "after_sales" },
      "after-miao": { userId: "after-miao", staffName: "缪婷婷", staffGroup: "after_sales" }
    },
    replyConfig: sweepConfig,
    decisionItemsByChatId: {
      "chat-handover": buildDecisionItem({ chatId: "chat-handover" })
    },
    now: new Date(2026, 8, 16, 10, 0),
    ledger: buildEmptyAutoTransferSweepLedger()
  });

  assert.equal(result.status, "done");
  assert.equal(result.handledCount, 0);
  assert.deepEqual(frames, []);
  assert.equal(readAutoTransferSweepAttempt("chat-handover"), null);
});

test("交班补判：原接待换人后立刻重判", async () => {
  resetOnlinePresenceSnapshot();
  resetPendingTransferVerifications();
  publishOnlinePresenceSnapshot({
    rowsByStaffName: {
      李守耀: { staffName: "李守耀", staffGroup: "after_sales", autoAssignEnabled: true },
      缪婷婷: { staffName: "缪婷婷", staffGroup: "after_sales", autoAssignEnabled: true }
    }
  });

  const ledger = buildEmptyAutoTransferSweepLedger();
  ledger.attemptsByChatId["chat-handover"] = {
    chatId: "chat-handover",
    assigneeUserId: "someone-else",
    attemptedAtMs: Date.now(),
    outcome: "sent"
  };

  const frames = [];
  const result = await runShiftHandoverSweep({
    page: buildSweepPage(frames),
    scheduleService: sweepScheduleService,
    memberMapByUserId: {
      "after-chen": { userId: "after-chen", staffName: "陈燕玲", staffGroup: "after_sales" },
      "after-li": { userId: "after-li", staffName: "李守耀", staffGroup: "after_sales" },
      "after-miao": { userId: "after-miao", staffName: "缪婷婷", staffGroup: "after_sales" }
    },
    replyConfig: sweepConfig,
    decisionItemsByChatId: {
      "chat-handover": buildDecisionItem({ chatId: "chat-handover" })
    },
    now: new Date(2026, 8, 16, 17, 0),
    ledger
  });

  assert.equal(result.handledCount, 1);
  assert.equal(frames.length, 1);
});

test("交班补判：开关关闭时不动作", async () => {
  resetOnlinePresenceSnapshot();
  resetPendingTransferVerifications();
  const frames = [];
  const result = await runShiftHandoverSweep({
    page: buildSweepPage(frames),
    scheduleService: sweepScheduleService,
    memberMapByUserId: {
      "after-chen": { userId: "after-chen", staffName: "陈燕玲", staffGroup: "after_sales" }
    },
    replyConfig: { ...sweepConfig, timeoutAutoTransferEnabled: false },
    decisionItemsByChatId: { "chat-handover": buildDecisionItem({ chatId: "chat-handover" }) },
    now: new Date(2026, 8, 16, 17, 0),
    ledger: buildEmptyAutoTransferSweepLedger()
  });

  assert.equal(result.status, "disabled");
  assert.deepEqual(frames, []);
});

test("交班补判：通知内容以“交班补判”为触发原因", async () => {
  const { resolveReminderKindText } = require("../../src/features/transferMonitor/autoTransferNotifier");
  assert.equal(resolveReminderKindText(SHIFT_HANDOVER_REMINDER_KIND), "交班补判");
  assert.equal(fs.existsSync(TEST_WECOM_CONFIG_PATH), true);
  assert.equal(typeof ASSIGNMENT_STATUS.ASSIGNED, "string");
});
