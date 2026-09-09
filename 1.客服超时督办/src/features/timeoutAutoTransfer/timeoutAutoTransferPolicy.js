// 该文件只负责裁决“当前超时事件能否转给哪名值班售前”，不依赖页面或接口写入。
const { ASSIGNMENT_STATUS } = require("../shared/currentAssignment");
const { resolveExpectedShiftStageForGroup } = require("../onlinePresenceMonitor/onlinePresencePolicy");

const AUTO_TRANSFER_REMINDER_KINDS = new Set(["timeout", "missedReply"]);
const SHIFT_LABEL_BY_STAGE = Object.freeze({
  early: "早班",
  late: "晚班"
});

function noTransferDecision(reason, extra = {}) {
  return {
    shouldTransfer: false,
    reason,
    ...extra
  };
}

function normalizeStaffName(value) {
  return String(value || "").trim();
}

function listDutyPreSalesMembers(scheduleData, memberMapByUserId, expectedShiftStage) {
  // Object.entries 保留排班表从上到下的顺序；多个有色单元格只取第一名。
  const expectedShiftLabel = SHIFT_LABEL_BY_STAGE[expectedShiftStage];
  if (!expectedShiftLabel) {
    return [];
  }

  const members = Object.values(memberMapByUserId || {});
  return Object.entries(scheduleData?.shiftMap || {})
    .filter(([, shiftInfo]) =>
      shiftInfo?.normalizedShift === expectedShiftLabel &&
      shiftInfo?.hasBackgroundColor === true
    )
    .map(([staffName, shiftInfo]) => {
      const normalizedStaffName = normalizeStaffName(staffName);
      const member = members.find((item) =>
        normalizeStaffName(item?.staffName) === normalizedStaffName &&
        item?.staffGroup === "pre_sales"
      );
      return member
        ? {
            member,
            staffName: normalizedStaffName,
            shiftInfo
          }
        : null;
    })
    .filter(Boolean);
}

function decideTimeoutAutoTransfer(input = {}) {
  // 这条规则只在超时/漏回复事件真正到点后执行，普通未回复候选不会提前转接。
  const reminderKind = String(input.candidate?.reminderKind || "").trim();
  if (!AUTO_TRANSFER_REMINDER_KINDS.has(reminderKind)) {
    return noTransferDecision("not_transfer_reminder_kind");
  }

  if (input.config?.timeoutAutoTransferEnabled !== true) {
    return noTransferDecision("disabled");
  }

  const assignment = input.assignment || {};
  if (assignment.status !== ASSIGNMENT_STATUS.ASSIGNED) {
    return noTransferDecision("current_assignment_not_directly_assigned", {
      assignmentStatus: assignment.status || ""
    });
  }

  if (assignment.assigneeMember?.staffGroup !== "operation") {
    return noTransferDecision("current_assignee_not_operation", {
      currentAssigneeName: normalizeStaffName(assignment.assigneeMember?.staffName)
    });
  }

  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  if (Number.isNaN(now.getTime())) {
    return noTransferDecision("invalid_current_time");
  }

  let expectedShiftStage = "";
  try {
    expectedShiftStage = resolveExpectedShiftStageForGroup(input.config, "pre_sales", now);
  } catch (error) {
    return noTransferDecision("invalid_pre_sales_work_time", {
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }
  if (!expectedShiftStage) {
    return noTransferDecision("outside_pre_sales_work_time");
  }

  const scheduleData = input.scheduleData;
  if (scheduleData?.backgroundColorAvailable !== true) {
    return noTransferDecision("background_color_unavailable", {
      expectedShiftStage
    });
  }

  const candidates = listDutyPreSalesMembers(
    scheduleData,
    input.memberMapByUserId,
    expectedShiftStage
  );
  if (candidates.length === 0) {
    return noTransferDecision("no_colored_duty_pre_sales", {
      expectedShiftStage
    });
  }

  const target = candidates[0];
  const targetUserId = normalizeStaffName(target.member?.userId);
  if (!targetUserId) {
    return noTransferDecision("duty_pre_sales_user_id_missing", {
      expectedShiftStage,
      targetStaffName: target.staffName
    });
  }

  if (targetUserId === normalizeStaffName(assignment.assignedToUserId)) {
    return noTransferDecision("already_assigned_to_duty_pre_sales", {
      expectedShiftStage,
      targetStaffName: target.staffName,
      targetUserId,
      targetBackgroundColor: target.shiftInfo.backgroundColor || ""
    });
  }

  return {
    shouldTransfer: true,
    reason: "eligible",
    reminderKind,
    expectedShiftStage,
    targetStaffName: target.staffName,
    targetUserId,
    targetBackgroundColor: target.shiftInfo.backgroundColor || "",
    targetMember: target.member,
    currentAssigneeName: normalizeStaffName(assignment.assigneeMember?.staffName)
  };
}

module.exports = {
  AUTO_TRANSFER_REMINDER_KINDS,
  decideTimeoutAutoTransfer,
  listDutyPreSalesMembers
};
