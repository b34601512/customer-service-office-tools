const test = require("node:test");
const assert = require("node:assert/strict");

const { ASSIGNMENT_STATUS } = require("../../src/features/shared/currentAssignment");
const {
  publishOnlinePresenceSnapshot,
  resetOnlinePresenceSnapshot
} = require("../../src/features/onlinePresenceMonitor/onlinePresenceSnapshotStore");
const {
  decideTimeoutAutoTransfer,
  listDutyGroupMembers
} = require("../../src/features/timeoutAutoTransfer/timeoutAutoTransferPolicy");

const config = {
  timeoutAutoTransferEnabled: true,
  onlinePresenceWorkStartTime: "08:00",
  offDutyPreSalesEarlyCloseTime: "16:30",
  offDutyPreSalesLateCloseTime: "23:45",
  offDutyAfterSalesEarlyCloseTime: "16:30",
  offDutyAfterSalesLateCloseTime: "22:30"
};

const memberMapByUserId = {
  "operation-1": { userId: "operation-1", staffName: "运营", staffGroup: "operation" },
  "pre-han": { userId: "pre-han", staffName: "韩欢欢", staffGroup: "pre_sales" },
  "pre-ye": { userId: "pre-ye", staffName: "叶炳辉", staffGroup: "pre_sales" },
  "pre-liu": { userId: "pre-liu", staffName: "刘秀文", staffGroup: "pre_sales" },
  "after-li": { userId: "after-li", staffName: "李守耀", staffGroup: "after_sales" },
  "after-chen": { userId: "after-chen", staffName: "陈燕玲", staffGroup: "after_sales" },
  "after-miao": { userId: "after-miao", staffName: "缪婷婷", staffGroup: "after_sales" },
  "manager-1": { userId: "manager-1", staffName: "黎经理", staffGroup: "management" }
};

function buildAssignment(userId, staffGroup, staffName) {
  return {
    assignedToUserId: userId,
    status: ASSIGNMENT_STATUS.ASSIGNED,
    assigneeMember: { userId, staffName, staffGroup }
  };
}

function buildScheduleData(overrides = {}) {
  const { shiftMap: shiftMapOverrides, ...restOverrides } = overrides;
  return {
    backgroundColorAvailable: true,
    ...restOverrides,
    shiftMap: {
      韩欢欢: { normalizedShift: "早班", hasBackgroundColor: true, backgroundColor: "#E2F0D9" },
      叶炳辉: { normalizedShift: "早班", hasBackgroundColor: false, backgroundColor: "" },
      刘秀文: { normalizedShift: "晚班", hasBackgroundColor: true, backgroundColor: "#FFF2CC" },
      李守耀: { normalizedShift: "早班", hasBackgroundColor: true, backgroundColor: "#E2F0D9" },
      陈燕玲: { normalizedShift: "早班", hasBackgroundColor: false, backgroundColor: "" },
      缪婷婷: { normalizedShift: "晚班", hasBackgroundColor: true, backgroundColor: "#FFF2CC" },
      ...(shiftMapOverrides || {})
    }
  };
}

function publishPresence(rowsByStaffName) {
  publishOnlinePresenceSnapshot({ rowsByStaffName });
}

function buildCandidate(reminderKind = "timeout") {
  return { chatId: "chat-1", reminderKind, customerName: "客户甲" };
}

function decide(input = {}) {
  return decideTimeoutAutoTransfer({
    candidate: buildCandidate(),
    assignment: buildAssignment("operation-1", "operation", "运营"),
    memberMapByUserId,
    scheduleData: buildScheduleData(),
    config,
    now: new Date(2026, 8, 16, 10, 0),
    ...input
  });
}

test.beforeEach(() => {
  resetOnlinePresenceSnapshot();
  publishPresence({
    韩欢欢: { staffName: "韩欢欢", staffGroup: "pre_sales", transferEnabled: true, autoAssignEnabled: false },
    刘秀文: { staffName: "刘秀文", staffGroup: "pre_sales", transferEnabled: true, autoAssignEnabled: false },
    李守耀: { staffName: "李守耀", staffGroup: "after_sales", transferEnabled: false, autoAssignEnabled: true },
    陈燕玲: { staffName: "陈燕玲", staffGroup: "after_sales", transferEnabled: false, autoAssignEnabled: false },
    缪婷婷: { staffName: "缪婷婷", staffGroup: "after_sales", transferEnabled: false, autoAssignEnabled: true }
  });
});

test("运营接待时应该转给当班且在线的售前", () => {
  const result = decide();

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "韩欢欢");
  assert.equal(result.targetUserId, "pre-han");
  assert.equal(result.targetStaffGroup, "pre_sales");
  assert.equal(result.sourceStaffGroup, "operation");
  assert.equal(result.expectedShiftStage, "early");
  assert.equal(result.requiresAttention, false);
});

test("带值班标记但没开接单开关的当班客服不能接手，需要提醒主管", () => {
  publishPresence({
    韩欢欢: { staffName: "韩欢欢", staffGroup: "pre_sales", transferEnabled: false, autoAssignEnabled: false }
  });

  const result = decide();

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "duty_member_offline");
  assert.equal(result.requiresAttention, true);
  assert.deepEqual(result.offlineStaffNames, ["韩欢欢"]);
});

test("多个当班售前时应该跳过离线的人，选第一个在线的", () => {
  const scheduleData = buildScheduleData({
    shiftMap: {
      叶炳辉: { normalizedShift: "早班", hasBackgroundColor: true, backgroundColor: "#FFF2CC" }
    }
  });
  publishPresence({
    韩欢欢: { staffName: "韩欢欢", staffGroup: "pre_sales", transferEnabled: false, autoAssignEnabled: false },
    叶炳辉: { staffName: "叶炳辉", staffGroup: "pre_sales", transferEnabled: true, autoAssignEnabled: false }
  });

  const result = decide({ scheduleData });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "叶炳辉");
  assert.deepEqual(result.offlineDutyStaffNames, ["韩欢欢"]);
});

test("当班客服自己在超时就不转，避免把客户从他手里转走", () => {
  const result = decide({
    assignment: buildAssignment("pre-han", "pre_sales", "韩欢欢")
  });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "current_assignee_on_duty");
  assert.equal(result.currentAssigneeShift, "早班");
});

test("早班售前在晚班时段超时，应该转给当班晚班售前", () => {
  const result = decide({
    assignment: buildAssignment("pre-han", "pre_sales", "韩欢欢"),
    now: new Date(2026, 8, 16, 18, 0)
  });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "刘秀文");
  assert.equal(result.expectedShiftStage, "late");
  assert.equal(result.currentAssigneeOffDutyReason, "shift_stage_mismatch");
});

test("售后超时只转售后，绝不跨组转售前", () => {
  const result = decide({
    assignment: buildAssignment("after-li", "after_sales", "李守耀"),
    now: new Date(2026, 8, 16, 18, 0)
  });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "缪婷婷");
  assert.equal(result.targetStaffGroup, "after_sales");
});

test("售后自己当班时超时也不转", () => {
  const result = decide({
    assignment: buildAssignment("after-li", "after_sales", "李守耀")
  });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "current_assignee_on_duty");
});

test("售后当天休息时超时应该转给当班售后", () => {
  const scheduleData = buildScheduleData({
    shiftMap: {
      李守耀: { normalizedShift: "休息", hasBackgroundColor: false, backgroundColor: "" },
      陈燕玲: { normalizedShift: "早班", hasBackgroundColor: true, backgroundColor: "#E2F0D9" }
    }
  });
  publishPresence({
    陈燕玲: { staffName: "陈燕玲", staffGroup: "after_sales", autoAssignEnabled: true }
  });

  const result = decide({
    assignment: buildAssignment("after-li", "after_sales", "李守耀"),
    scheduleData
  });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "陈燕玲");
  assert.equal(result.currentAssigneeOffDutyReason, "no_scheduled_shift_today");
});

test("售后全部下班后不转，也不惊动主管", () => {
  const result = decide({
    assignment: buildAssignment("after-li", "after_sales", "李守耀"),
    now: new Date(2026, 8, 16, 23, 0)
  });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "outside_target_group_work_time");
  assert.equal(result.requiresAttention, false);
});

test("当班没有带值班标记的客服时要提醒主管", () => {
  // 原接待自己排的是晚班，10 点属于不在班，而早班售后没有任何值班标记，属于无人可接。
  const result = decide({
    assignment: buildAssignment("after-miao", "after_sales", "缪婷婷"),
    scheduleData: buildScheduleData({
      shiftMap: {
        李守耀: { normalizedShift: "早班", hasBackgroundColor: false, backgroundColor: "" }
      }
    })
  });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "no_colored_duty_member");
  assert.equal(result.requiresAttention, true);
});

test("排班背景色读不到时不转并提醒主管", () => {
  const result = decide({
    scheduleData: { backgroundColorAvailable: false, shiftMap: {} }
  });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "background_color_unavailable");
  assert.equal(result.requiresAttention, true);
});

test("上班监控快照过期或缺少该成员时按无依据处理，不擅自转接", () => {
  resetOnlinePresenceSnapshot();
  const stale = decide();
  assert.equal(stale.reason, "presence_unavailable");
  assert.equal(stale.requiresAttention, false);

  publishPresence({
    刘秀文: { staffName: "刘秀文", staffGroup: "pre_sales", transferEnabled: false, autoAssignEnabled: false }
  });
  const missing = decide();
  assert.equal(missing.reason, "presence_unavailable");
  assert.equal(missing.requiresAttention, false);
});

test("非超时/漏回复、开关关闭、非直接分配、管理组都不转", () => {
  assert.equal(decide({ candidate: { chatId: "c", reminderKind: "normal" } }).reason, "not_transfer_reminder_kind");
  assert.equal(decide({ config: { ...config, timeoutAutoTransferEnabled: false } }).reason, "disabled");
  assert.equal(
    decide({ assignment: { assignedToUserId: "", status: ASSIGNMENT_STATUS.UNASSIGNED, assigneeMember: null } }).reason,
    "current_assignment_not_directly_assigned"
  );
  assert.equal(
    decide({ assignment: buildAssignment("manager-1", "management", "黎经理") }).reason,
    "unsupported_assignee_group"
  );
});

test("漏回复提醒同样参与同组转接", () => {
  const result = decide({ candidate: buildCandidate("missedReply") });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.reminderKind, "missedReply");
  assert.equal(result.targetStaffName, "韩欢欢");
});

test("当班名单只取当天该班次且带值班标记的同组客服", () => {
  const candidates = listDutyGroupMembers(buildScheduleData(), memberMapByUserId, "pre_sales", "early");

  assert.deepEqual(candidates.map((item) => item.staffName), ["韩欢欢"]);
  assert.deepEqual(
    listDutyGroupMembers(buildScheduleData(), memberMapByUserId, "after_sales", "late").map((item) => item.staffName),
    ["缪婷婷"]
  );
  assert.deepEqual(
    listDutyGroupMembers(buildScheduleData(), memberMapByUserId, "after_sales", "early").map((item) => item.staffName),
    ["李守耀"]
  );
});
