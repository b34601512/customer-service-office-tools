const test = require("node:test");
const assert = require("node:assert/strict");

const { ASSIGNMENT_STATUS } = require("../../src/features/shared/currentAssignment");
const {
  publishOnlinePresenceSnapshot,
  resetOnlinePresenceSnapshot
} = require("../../src/features/onlinePresenceMonitor/onlinePresenceSnapshotStore");
const {
  decideTimeoutAutoTransfer,
  listOnShiftGroupMembers
} = require("../../src/features/timeoutAutoTransfer/timeoutAutoTransferPolicy");

const config = {
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

const memberMapByUserId = {
  "operation-1": { userId: "operation-1", staffName: "运营", staffGroup: "operation" },
  "pre-han": { userId: "pre-han", staffName: "周九", staffGroup: "pre_sales" },
  "pre-ye": { userId: "pre-ye", staffName: "冯十三", staffGroup: "pre_sales" },
  "pre-liu": { userId: "pre-liu", staffName: "吴十", staffGroup: "pre_sales" },
  "after-li": { userId: "after-li", staffName: "李四", staffGroup: "after_sales" },
  "after-chen": { userId: "after-chen", staffName: "孙八", staffGroup: "after_sales" },
  "after-miao": { userId: "after-miao", staffName: "王五", staffGroup: "after_sales" },
  "after-ke": { userId: "after-ke", staffName: "赵六", staffGroup: "after_sales" },
  "after-deng": { userId: "after-deng", staffName: "钱七", staffGroup: "after_sales" },
  "manager-1": { userId: "manager-1", staffName: "黎经理", staffGroup: "" }
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
      周九: { normalizedShift: "早班", hasBackgroundColor: true, backgroundColor: "#E2F0D9" },
      冯十三: { normalizedShift: "早班", hasBackgroundColor: false, backgroundColor: "" },
      吴十: { normalizedShift: "晚班", hasBackgroundColor: true, backgroundColor: "#FFF2CC" },
      李四: { normalizedShift: "早班", hasBackgroundColor: true, backgroundColor: "#E2F0D9" },
      孙八: { normalizedShift: "早班", hasBackgroundColor: false, backgroundColor: "" },
      王五: { normalizedShift: "晚班", hasBackgroundColor: true, backgroundColor: "#FFF2CC" },
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
    周九: { staffName: "周九", staffGroup: "pre_sales", transferEnabled: true, autoAssignEnabled: false },
    吴十: { staffName: "吴十", staffGroup: "pre_sales", transferEnabled: true, autoAssignEnabled: false },
    李四: { staffName: "李四", staffGroup: "after_sales", transferEnabled: false, autoAssignEnabled: true },
    孙八: { staffName: "孙八", staffGroup: "after_sales", transferEnabled: false, autoAssignEnabled: false },
    王五: { staffName: "王五", staffGroup: "after_sales", transferEnabled: false, autoAssignEnabled: true }
  });
});

test("运营接待时应该转给当班且在线的售前", () => {
  const result = decide();

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "周九");
  assert.equal(result.targetUserId, "pre-han");
  assert.equal(result.targetStaffGroup, "pre_sales");
  assert.equal(result.sourceStaffGroup, "operation");
  assert.equal(result.expectedShiftStage, "early");
  assert.equal(result.targetShiftLabel, "早班");
  assert.equal(result.requiresAttention, false);
});

test("当班但没上线的客服不能接手，需要提醒主管", () => {
  publishPresence({
    周九: { staffName: "周九", staffGroup: "pre_sales", transferEnabled: false, autoAssignEnabled: false }
  });

  const result = decide();

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "on_shift_member_offline");
  assert.equal(result.requiresAttention, true);
  assert.deepEqual(result.offlineStaffNames, ["周九"]);
});

test("有没有值班标记都不影响挑人，先当班先上线就能接", () => {
  // 用户口径：不看值班标记/组长/背景色，同组、当班、在线就能接。
  const scheduleData = buildScheduleData({
    shiftMap: {
      周九: { normalizedShift: "早班", hasBackgroundColor: false, backgroundColor: "" }
    }
  });

  const result = decide({ scheduleData });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "周九");
  assert.equal(result.expectedShiftStage, "early");
});

test("多个当班售前时应该跳过离线的人，选第一个在线的", () => {
  const scheduleData = buildScheduleData({
    shiftMap: {
      冯十三: { normalizedShift: "早班", hasBackgroundColor: false, backgroundColor: "" }
    }
  });
  publishPresence({
    周九: { staffName: "周九", staffGroup: "pre_sales", transferEnabled: false, autoAssignEnabled: false },
    冯十三: { staffName: "冯十三", staffGroup: "pre_sales", transferEnabled: true, autoAssignEnabled: false }
  });

  const result = decide({ scheduleData });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "冯十三");
  assert.deepEqual(result.offlineStaffNames, ["周九"]);
});

test("售前值班人不在线时，同班次其他在线的售前也能接", () => {
  // 用户口径：不管售前售后，只要有人在线就可以转。
  publishPresence({
    周九: { staffName: "周九", staffGroup: "pre_sales", transferEnabled: false, autoAssignEnabled: false },
    冯十三: { staffName: "冯十三", staffGroup: "pre_sales", transferEnabled: true, autoAssignEnabled: false }
  });
  const scheduleData = buildScheduleData({
    shiftMap: {
      冯十三: { normalizedShift: "早班", hasBackgroundColor: false, backgroundColor: "" }
    }
  });

  const result = decide({ scheduleData });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "冯十三");
  assert.equal(result.offlineStaffNames.includes("周九"), true);
});

test("早晚班重叠期间早班人还在班且在线，不能把他当成没人管", () => {
  // 售后早班 8:00~16:30、晚班 14:00 到岗；15:00 早班的人仍在上班（且在线），客户不能从他手里转走。
  publishPresence({
    孙八: { staffName: "孙八", staffGroup: "after_sales", autoAssignEnabled: true },
    王五: { staffName: "王五", staffGroup: "after_sales", autoAssignEnabled: true }
  });
  const result = decide({
    assignment: buildAssignment("after-chen", "after_sales", "孙八"),
    now: new Date(2026, 8, 16, 15, 0)
  });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "current_assignee_on_duty");
  assert.equal(result.currentAssigneeShift, "早班");
});

test("售前重叠期间早班人还在班，同样不转", () => {
  const result = decide({
    assignment: buildAssignment("pre-liu", "pre_sales", "吴十"),
    now: new Date(2026, 8, 16, 16, 0)
  });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "current_assignee_on_duty");
});

test("早班人过了自己下班时间就该转给当班在线的人", () => {
  // 售后早班 16:30 下班，16:45 就该把客户交给当班在线的售后。
  const result = decide({
    assignment: buildAssignment("after-chen", "after_sales", "孙八"),
    now: new Date(2026, 8, 16, 16, 45)
  });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "王五");
  assert.equal(result.currentAssigneeOffDutyReason, "outside_own_shift_window");
  assert.equal(result.expectedShiftStage, "late");
  assert.equal(result.targetStaffGroup, "after_sales");
});

test("晚班未到岗时就该转给当班在线的同组客服", () => {
  // 售后晚班 14:00 到岗，13:00 排晚班的人还没上班 → 转给当班在线的售后。
  const result = decide({
    assignment: buildAssignment("after-miao", "after_sales", "王五"),
    now: new Date(2026, 8, 16, 13, 0)
  });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "李四");
  assert.equal(result.currentAssigneeShift, "晚班");
  assert.equal(result.currentAssigneeOffDutyReason, "outside_own_shift_window");
  assert.equal(result.targetStaffGroup, "after_sales");
  assert.equal(result.expectedShiftStage, "early");
});

test("售后超时只转售后，绝不跨组转售前", () => {
  const result = decide({
    assignment: buildAssignment("after-li", "after_sales", "李四"),
    now: new Date(2026, 8, 16, 18, 0)
  });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "王五");
  assert.equal(result.targetStaffGroup, "after_sales");
});

test("售后自己当班时超时也不转", () => {
  const result = decide({
    assignment: buildAssignment("after-li", "after_sales", "李四")
  });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "current_assignee_on_duty");
});

test("售后当天休息时超时应该转给当班售后的任意在线同事", () => {
  const scheduleData = buildScheduleData({
    shiftMap: {
      李四: { normalizedShift: "休息", hasBackgroundColor: true, backgroundColor: "#E2F0D9" },
      孙八: { normalizedShift: "早班", hasBackgroundColor: false, backgroundColor: "" }
    }
  });
  publishPresence({
    孙八: { staffName: "孙八", staffGroup: "after_sales", autoAssignEnabled: true }
  });

  const result = decide({
    assignment: buildAssignment("after-li", "after_sales", "李四"),
    scheduleData
  });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "孙八");
  assert.equal(result.currentAssigneeOffDutyReason, "no_scheduled_shift_today");
});

test("售后晚班另一位在线时，即使值班人没上线也要转给他（2026-09-16 线上真实情况）", () => {
  // 蓝标值班人赵六当天没上线，同班次的王五一直在线；客户必须有人回。
  const scheduleData = {
    backgroundColorAvailable: true,
    shiftMap: {
      赵六: { normalizedShift: "晚班", hasBackgroundColor: true, backgroundColor: "#BDD7EE" },
      王五: { normalizedShift: "晚班", hasBackgroundColor: false, backgroundColor: "" }
    }
  };
  publishPresence({
    赵六: { staffName: "赵六", staffGroup: "after_sales", autoAssignEnabled: false },
    王五: { staffName: "王五", staffGroup: "after_sales", autoAssignEnabled: true }
  });

  const result = decide({
    assignment: buildAssignment("after-chen", "after_sales", "孙八"),
    scheduleData,
    now: new Date(2026, 8, 16, 17, 0)
  });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "王五");
  assert.equal(result.targetUserId, "after-miao");
  assert.deepEqual(result.offlineStaffNames, ["赵六"]);
});

test("售后全部下班后不转，也不惊动主管", () => {
  const result = decide({
    assignment: buildAssignment("after-li", "after_sales", "李四"),
    now: new Date(2026, 8, 16, 23, 0)
  });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "outside_target_group_work_time");
  assert.equal(result.requiresAttention, false);
});

test("休息/年假的人不算当班，不参与转接", () => {
  // 休息/年假不属于早/晚班；即使开着接单开关也不能接客户。
  publishPresence({
    孙八: { staffName: "孙八", staffGroup: "after_sales", autoAssignEnabled: true },
    钱七: { staffName: "钱七", staffGroup: "after_sales", autoAssignEnabled: true }
  });

  const result = decide({
    assignment: buildAssignment("after-miao", "after_sales", "王五"),
    scheduleData: buildScheduleData({
      shiftMap: {
        李四: { normalizedShift: "休息", hasBackgroundColor: false, backgroundColor: "" },
        孙八: { normalizedShift: "休息", hasBackgroundColor: true, backgroundColor: "#E2F0D9" },
        王五: { normalizedShift: "晚班", hasBackgroundColor: false, backgroundColor: "" },
        钱七: { normalizedShift: "年假", hasBackgroundColor: true, backgroundColor: "#BDD7EE" }
      }
    })
  });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "no_on_shift_member");
  assert.equal(result.requiresAttention, true);
});

test("排班表读不到时不转，也不惊动主管", () => {
  const result = decide({ scheduleData: { backgroundColorAvailable: false, shiftMap: {} } });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "schedule_unavailable");
  assert.equal(result.requiresAttention, false);
});

test("上班监控快照过期或缺少该成员时按无依据处理，不擅自转接", () => {
  resetOnlinePresenceSnapshot();
  const stale = decide();
  assert.equal(stale.reason, "presence_unavailable");
  assert.equal(stale.requiresAttention, false);

  publishPresence({
    吴十: { staffName: "吴十", staffGroup: "pre_sales", transferEnabled: false, autoAssignEnabled: false }
  });
  const missing = decide();
  assert.equal(missing.reason, "presence_unavailable");
  assert.equal(missing.requiresAttention, false);
});

test("非超时/漏回复、开关关闭、非直接分配、无法识别分组的不转", () => {
  assert.equal(decide({ candidate: { chatId: "c", reminderKind: "normal" } }).reason, "not_transfer_reminder_kind");
  assert.equal(decide({ config: { ...config, timeoutAutoTransferEnabled: false } }).reason, "disabled");
  assert.equal(
    decide({ assignment: { assignedToUserId: "", status: ASSIGNMENT_STATUS.UNASSIGNED, assigneeMember: null } }).reason,
    "current_assignment_not_directly_assigned"
  );
  assert.equal(
    decide({ assignment: buildAssignment("mgr-2", "management", "行政值班") }).reason,
    "unsupported_assignee_group"
  );
});

test("黎经理无角色后缀时应按运营转给当班在线售前", () => {
  const result = decide({
    assignment: buildAssignment("manager-1", "", "黎经理"),
    candidate: buildCandidate("missedReply")
  });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.sourceStaffGroup, "operation");
  assert.equal(result.targetStaffGroup, "pre_sales");
  assert.equal(result.targetStaffName, "周九");
});

test("漏回复提醒同样参与同组转接", () => {
  const result = decide({ candidate: buildCandidate("missedReply") });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.reminderKind, "missedReply");
  assert.equal(result.targetStaffName, "周九");
});

test("当班名单按本人班次时间窗取人，且只取同组", () => {
  const now = new Date(2026, 8, 16, 10, 0);
  const preSales = listOnShiftGroupMembers({
    scheduleData: buildScheduleData(),
    memberMapByUserId,
    staffGroup: "pre_sales",
    config,
    now
  });
  assert.deepEqual(preSales.map((item) => item.staffName), ["周九", "冯十三"]);

  const afterSales = listOnShiftGroupMembers({
    scheduleData: buildScheduleData(),
    memberMapByUserId,
    staffGroup: "after_sales",
    config,
    now
  });
  assert.deepEqual(afterSales.map((item) => item.staffName), ["李四", "孙八"]);

  const overlap = listOnShiftGroupMembers({
    scheduleData: buildScheduleData(),
    memberMapByUserId,
    staffGroup: "after_sales",
    config,
    now: new Date(2026, 8, 16, 15, 0)
  });
  // 15:00 售后早晚班人都在班（早班 16:30 才下班）。
  assert.deepEqual(overlap.map((item) => item.staffName), ["李四", "孙八", "王五"]);
});

test("原接待在班但没上线时也算没人管，转给当班在线的人", () => {
  // 用户口径（2026-09-16）：“在班，但是没上线当然也算是没人管，直接转给当班在线的人就行”。
  publishPresence({
    李四: { staffName: "李四", staffGroup: "after_sales", autoAssignEnabled: true },
    孙八: { staffName: "孙八", staffGroup: "after_sales", autoAssignEnabled: false }
  });

  const result = decide({
    assignment: buildAssignment("after-chen", "after_sales", "孙八")
  });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "李四");
  assert.equal(result.currentAssigneeOffDutyReason, "shift_on_duty_but_offline");
  assert.equal(result.currentAssigneeShift, "早班");
});

test("售前在班但没上线时同样转给当班在线的售前", () => {
  publishPresence({
    周九: { staffName: "周九", staffGroup: "pre_sales", transferEnabled: false },
    冯十三: { staffName: "冯十三", staffGroup: "pre_sales", transferEnabled: true }
  });

  const result = decide({
    assignment: buildAssignment("pre-han", "pre_sales", "周九")
  });

  assert.equal(result.shouldTransfer, true);
  assert.equal(result.targetStaffName, "冯十三");
  assert.equal(result.currentAssigneeOffDutyReason, "shift_on_duty_but_offline");
});

test("原接待在线状态查不到时不擅自转走客户", () => {
  publishPresence({
    王五: { staffName: "王五", staffGroup: "after_sales", autoAssignEnabled: true }
  });

  const result = decide({
    assignment: buildAssignment("after-chen", "after_sales", "孙八")
  });

  assert.equal(result.shouldTransfer, false);
  assert.equal(result.reason, "current_assignee_on_duty");
  assert.equal(result.currentAssigneeOnDutyReason, "shift_on_duty_presence_unknown");
});
