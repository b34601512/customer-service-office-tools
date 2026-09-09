const test = require("node:test");
const assert = require("node:assert/strict");

const { ASSIGNMENT_STATUS } = require("../../src/features/shared/currentAssignment");
const { attemptTimeoutAutoTransfer } = require("../../src/features/missedReplyMonitor/missedReplyWorkflow/reminderProcessor");
const {
  decideTimeoutAutoTransfer,
  listDutyPreSalesMembers
} = require("../../src/features/timeoutAutoTransfer/timeoutAutoTransferPolicy");

const config = {
  timeoutAutoTransferEnabled: true,
  onlinePresenceWorkStartTime: "08:00",
  offDutyPreSalesEarlyCloseTime: "16:30",
  offDutyPreSalesLateCloseTime: "23:45"
};

const assignment = {
  assignedToUserId: "operation-1",
  status: ASSIGNMENT_STATUS.ASSIGNED,
  assigneeMember: {
    staffName: "运营",
    staffGroup: "operation"
  }
};

const memberMapByUserId = {
  "operation-1": {
    userId: "operation-1",
    staffName: "运营",
    staffGroup: "operation"
  },
  "pre-han": {
    userId: "pre-han",
    staffName: "韩欢欢",
    staffGroup: "pre_sales"
  },
  "pre-ye": {
    userId: "pre-ye",
    staffName: "叶炳辉",
    staffGroup: "pre_sales"
  }
};

function buildScheduleData(overrides = {}) {
  return {
    backgroundColorAvailable: true,
    shiftMap: {
      韩欢欢: {
        normalizedShift: "早班",
        hasBackgroundColor: false,
        backgroundColor: ""
      },
      叶炳辉: {
        normalizedShift: "早班",
        hasBackgroundColor: true,
        backgroundColor: "#E2F0D9"
      }
    },
    ...overrides
  };
}

function buildCandidate(reminderKind) {
  return {
    chatId: "chat-1",
    reminderKind,
    customerName: "客户甲"
  };
}

test("首次超时和 10 倍漏回复都应选择首个有色值班售前", () => {
  for (const reminderKind of ["timeout", "missedReply"]) {
    const result = decideTimeoutAutoTransfer({
      candidate: buildCandidate(reminderKind),
      assignment,
      memberMapByUserId,
      scheduleData: buildScheduleData(),
      config,
      now: new Date(2026, 8, 9, 10, 0)
    });

    assert.equal(result.shouldTransfer, true);
    assert.equal(result.targetStaffName, "叶炳辉");
    assert.equal(result.targetUserId, "pre-ye");
  }
});

test("多个有色售前时应该按排班表顺序取第一名", () => {
  const scheduleData = buildScheduleData({
    shiftMap: {
      韩欢欢: {
        normalizedShift: "早班",
        hasBackgroundColor: true,
        backgroundColor: "#FFF2CC"
      },
      叶炳辉: {
        normalizedShift: "早班",
        hasBackgroundColor: true,
        backgroundColor: "#E2F0D9"
      }
    }
  });

  const candidates = listDutyPreSalesMembers(scheduleData, memberMapByUserId, "early");
  assert.deepEqual(candidates.map((item) => item.staffName), ["韩欢欢", "叶炳辉"]);
  assert.equal(candidates[0].member.userId, "pre-han");
});

test("背景色不可用、非运营接待或非工作时间都不应该自动转接", () => {
  const baseInput = {
    candidate: buildCandidate("timeout"),
    assignment,
    memberMapByUserId,
    scheduleData: buildScheduleData(),
    config,
    now: new Date(2026, 8, 9, 10, 0)
  };

  assert.equal(
    decideTimeoutAutoTransfer({ ...baseInput, scheduleData: { backgroundColorAvailable: false } }).reason,
    "background_color_unavailable"
  );
  assert.equal(
    decideTimeoutAutoTransfer({
      ...baseInput,
      assignment: { ...assignment, assigneeMember: { staffGroup: "pre_sales", staffName: "售前" } }
    }).reason,
    "current_assignee_not_operation"
  );
  assert.equal(
    decideTimeoutAutoTransfer({ ...baseInput, now: new Date(2026, 8, 9, 23, 50) }).reason,
    "outside_pre_sales_work_time"
  );
});

test("符合规则时提醒处理器应该调用自动转接接口", async () => {
  const seenInputs = [];
  const page = {
    async evaluate(pageFunction, input) {
      if (input === undefined) {
        return JSON.stringify({ token: "token_processor" });
      }

      seenInputs.push(input);
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({ code: 0 })
      };
    }
  };
  const scheduleService = {
    async readDailyShiftMap() {
      return buildScheduleData();
    }
  };

  const result = await attemptTimeoutAutoTransfer({
    page,
    scheduleService,
    candidate: buildCandidate("missedReply"),
    assignment,
    memberMapByUserId,
    replyConfig: config,
    now: new Date(2026, 8, 9, 10, 0)
  });

  assert.equal(result.status, "succeeded");
  assert.equal(seenInputs[0].body.chatId, "chat-1");
  assert.equal(seenInputs[0].body.assigneeId, "pre-ye");
});
