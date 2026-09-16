// 该文件只负责裁决“这条超时/漏回复提醒该不该自动转接、转给当前当班的谁”，不依赖页面或接口写入。
// 口径：原接待在值班时段（或在值班但已不是当前班次）就不转；确属不在班时，
// 运营 → 转当班售前（运营不接待），售前 → 转当班售前，售后 → 转当班售后，绝不跨组互转。
const { ASSIGNMENT_STATUS } = require("../shared/currentAssignment");
const {
  parseTimeTextToDate,
  resolveOffDutyCloseTime,
  resolveOffDutyStartTime,
  resolveShiftStage
} = require("../offDutyClose/offDutyConfig");
const { resolveExpectedShiftStageForGroup } = require("../onlinePresenceMonitor/onlinePresencePolicy");
const { resolveOnlinePresenceRow } = require("../onlinePresenceMonitor/onlinePresenceSnapshotStore");

const AUTO_TRANSFER_REMINDER_KINDS = new Set(["timeout", "missedReply"]);

const SHIFT_LABEL_BY_STAGE = Object.freeze({
  early: "早班",
  late: "晚班"
});

const STAFF_GROUP_LABELS = Object.freeze({
  after_sales: "售后",
  management: "管理",
  operation: "运营",
  pre_sales: "售前"
});

// 用户口径（2026-09-16）：黄色背景是休息/调休那类标记，没有值班含义，不能当值班人；
// 休息/年假/行政的人本来就不属于早/晚班班次，也不会被选为目标。
const MEANINGLESS_DUTY_BACKGROUND_COLORS = new Set(["#FFFF00"]);

function isDutyMarkedShift(shiftInfo) {
  // 只有“带背景色且颜色有值班含义”的班次才算值班标记。
  if (shiftInfo?.hasBackgroundColor !== true) {
    return false;
  }

  const backgroundColor = String(shiftInfo?.backgroundColor || "").trim().toUpperCase();
  return !MEANINGLESS_DUTY_BACKGROUND_COLORS.has(backgroundColor);
}

// 运营账号不负责接待，客户按售前口径处理；其余同组流转。
const TRANSFER_TARGET_GROUP_BY_SOURCE_GROUP = Object.freeze({
  after_sales: "after_sales",
  operation: "pre_sales",
  pre_sales: "pre_sales"
});

// 命中这些原因说明“客户当前确实没人能接手”，必须让主管知道，不能静默跳过。
const ATTENTION_REASONS = new Set([
  "background_color_unavailable",
  "no_duty_member",
  "duty_member_offline"
]);

function noTransferDecision(reason, extra = {}) {
  return {
    shouldTransfer: false,
    reason,
    requiresAttention: ATTENTION_REASONS.has(reason),
    ...extra
  };
}

function normalizeStaffName(value) {
  return String(value || "").trim();
}

function resolveStaffGroupLabel(staffGroup) {
  return STAFF_GROUP_LABELS[String(staffGroup || "").trim()] || String(staffGroup || "").trim();
}

function listDutyGroupMembers(scheduleData, memberMapByUserId, staffGroup, expectedShiftStage) {
  // 排班表当天该班次且带值班背景色的客服才算当班人；多个时沿用排班表从上到下的顺序。
  const expectedShiftLabel = SHIFT_LABEL_BY_STAGE[expectedShiftStage];
  if (!expectedShiftLabel || !staffGroup) {
    return [];
  }

  const members = Object.values(memberMapByUserId || {});
  return Object.entries(scheduleData?.shiftMap || {})
    .filter(([, shiftInfo]) =>
      shiftInfo?.normalizedShift === expectedShiftLabel &&
      isDutyMarkedShift(shiftInfo)
    )
    .map(([staffName, shiftInfo]) => {
      const normalizedStaffName = normalizeStaffName(staffName);
      const member = members.find((item) =>
        normalizeStaffName(item?.staffName) === normalizedStaffName &&
        item?.staffGroup === staffGroup
      );
      return member
        ? {
            member,
            staffName: normalizedStaffName,
            shiftInfo,
            dutySource: "background_color"
          }
        : null;
    })
    .filter(Boolean);
}

function listColoredStaffNamesByGroup(scheduleData, memberMapByUserId, staffGroup) {
  // 诊断用：列出该组当天所有带值班背景色的人（不分班次），排障时一眼看出“今天到底谁被标了值班”。
  if (!staffGroup) {
    return [];
  }
  const members = Object.values(memberMapByUserId || {});
  return Object.entries(scheduleData?.shiftMap || {})
    .filter(([, shiftInfo]) => shiftInfo?.hasBackgroundColor === true)
    .map(([staffName, shiftInfo]) => {
      const normalizedStaffName = normalizeStaffName(staffName);
      const member = members.find((item) =>
        normalizeStaffName(item?.staffName) === normalizedStaffName &&
        item?.staffGroup === staffGroup
      );
      return member ? `${normalizedStaffName}(${shiftInfo.normalizedShift || "-"})` : null;
    })
    .filter(Boolean);
}

function isGroupLeaderRoleLabel(roleLabel) {
  // 售后组长在班即值班（排班表不给组长标背景色），组长角色按角色文案识别，不写死具体姓名。
  return String(roleLabel || "").includes("组长");
}

function listGroupLeaderDutyMembers(scheduleData, memberMapByUserId, staffGroup, expectedShiftStage) {
  // 这里找出“当天该班次的组长”：组长固定值班，不依赖背景色。
  const expectedShiftLabel = SHIFT_LABEL_BY_STAGE[expectedShiftStage];
  if (!expectedShiftLabel || !staffGroup) {
    return [];
  }

  return Object.values(memberMapByUserId || {})
    .filter((member) =>
      member?.staffGroup === staffGroup &&
      isGroupLeaderRoleLabel(member?.roleLabel)
    )
    .map((member) => {
      const staffName = normalizeStaffName(member?.staffName);
      const shiftInfo = staffName ? scheduleData?.shiftMap?.[staffName] || null : null;
      if (!shiftInfo || shiftInfo?.normalizedShift !== expectedShiftLabel) {
        return null;
      }
      return {
        member,
        staffName,
        shiftInfo,
        dutySource: "group_leader"
      };
    })
    .filter(Boolean);
}

function collectDutyCandidates(input) {
  // 值班人 = 当天该班次的组长（固定值班、无背景色）+ 带值班背景色的客服；组长优先，同人去重。
  const leaderCandidates = listGroupLeaderDutyMembers(
    input.scheduleData,
    input.memberMapByUserId,
    input.targetStaffGroup,
    input.expectedShiftStage
  );
  const coloredCandidates = listDutyGroupMembers(
    input.scheduleData,
    input.memberMapByUserId,
    input.targetStaffGroup,
    input.expectedShiftStage
  );
  const seen = new Set();
  return [...leaderCandidates, ...coloredCandidates].filter((candidate) => {
    const key = normalizeStaffName(candidate?.member?.userId) || normalizeStaffName(candidate?.staffName);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function resolveTargetStaffGroup(assigneeMember) {
  // 成员角色缺失（未识别/经理等）时不做猜测，直接不转。
  const sourceStaffGroup = normalizeStaffName(assigneeMember?.staffGroup);
  return {
    sourceStaffGroup,
    targetStaffGroup: TRANSFER_TARGET_GROUP_BY_SOURCE_GROUP[sourceStaffGroup] || ""
  };
}

function isWithinOwnShiftWindow(config, staffGroup, shiftLabel, now) {
  // “在班”＝当前时刻落在本人班次的时间窗内（早班 8:00~16:30，晚班 15:45/14:00~23:45/22:30）。
  // 早晚班重叠时段（售后 14:00~16:30、售前 15:45~16:30）里早班人还没下班，不能把他当成不在班。
  const startTimeText = resolveOffDutyStartTime(config, staffGroup, shiftLabel);
  const closeTimeText = resolveOffDutyCloseTime(config, staffGroup, shiftLabel);
  if (!startTimeText || !closeTimeText) {
    return false;
  }

  const currentTime = now instanceof Date ? now : new Date(now || Date.now());
  if (Number.isNaN(currentTime.getTime())) {
    return false;
  }

  return (
    currentTime.getTime() >= parseTimeTextToDate(currentTime, startTimeText).getTime() &&
    currentTime.getTime() < parseTimeTextToDate(currentTime, closeTimeText).getTime()
  );
}

function isCurrentAssigneeOnDuty(input) {
  // 运营不参与排班值班，一律视为不在班；售前/售后看本人班次的时间窗是否覆盖当前时刻。
  const { assigneeMember, sourceStaffGroup, scheduleData, config, now } = input;
  if (sourceStaffGroup === "operation") {
    return { onDuty: false, reason: "operation_not_on_duty", shiftLabel: "" };
  }

  const staffName = normalizeStaffName(assigneeMember?.staffName);
  const shiftInfo = scheduleData?.shiftMap?.[staffName] || null;
  const shiftLabel = String(shiftInfo?.normalizedShift || "").trim();
  const shiftStage = resolveShiftStage(shiftLabel);
  if (!shiftInfo || !["early", "late"].includes(shiftStage)) {
    return { onDuty: false, reason: "no_scheduled_shift_today", shiftLabel };
  }

  if (!isWithinOwnShiftWindow(config, sourceStaffGroup, shiftLabel, now)) {
    // 早班过早/晚班未到、或已过本人下班时间，都算不在班。
    return { onDuty: false, reason: "outside_own_shift_window", shiftLabel };
  }

  return { onDuty: true, reason: "on_shift_now", shiftLabel };
}

function pickOnlineDutyTarget(input) {
  // 当班但是没开接单开关等于没在线，用户口径明确：不在线不能转。
  // 快照新鲜度按墙钟判断：上班快照本身就是按真实时间写的，不能用业务时间戳去比对它。
  const { candidates, staffGroup, nowMs = Date.now() } = input;
  const offlineStaffNames = [];
  const unknownStaffNames = [];
  const unknownReasons = [];

  for (const candidate of candidates) {
    const presence = resolveOnlinePresenceRow(candidate.staffName, staffGroup, nowMs);
    if (!presence.available) {
      unknownStaffNames.push(candidate.staffName);
      if (!unknownReasons.includes(presence.reason)) {
        unknownReasons.push(presence.reason);
      }
      continue;
    }

    if (presence.online) {
      return {
        target: candidate,
        offlineStaffNames,
        unknownStaffNames: [],
        unknownReasons: []
      };
    }

    offlineStaffNames.push(candidate.staffName);
  }

  return {
    target: null,
    offlineStaffNames,
    unknownStaffNames,
    unknownReasons
  };
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

  const assigneeMember = assignment.assigneeMember || null;
  const { sourceStaffGroup, targetStaffGroup } = resolveTargetStaffGroup(assigneeMember);
  const currentAssigneeName = normalizeStaffName(assigneeMember?.staffName);
  if (!targetStaffGroup) {
    return noTransferDecision("unsupported_assignee_group", {
      currentAssigneeName,
      sourceStaffGroup
    });
  }

  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  if (Number.isNaN(now.getTime())) {
    return noTransferDecision("invalid_current_time");
  }

  let expectedShiftStage = "";
  try {
    expectedShiftStage = resolveExpectedShiftStageForGroup(input.config, targetStaffGroup, now);
  } catch (error) {
    return noTransferDecision("invalid_work_time_config", {
      errorMessage: error instanceof Error ? error.message : String(error),
      targetStaffGroup
    });
  }
  if (!expectedShiftStage) {
    return noTransferDecision("outside_target_group_work_time", {
      currentAssigneeName,
      sourceStaffGroup,
      targetStaffGroup
    });
  }

  const scheduleData = input.scheduleData;
  if (scheduleData?.backgroundColorAvailable !== true) {
    return noTransferDecision("background_color_unavailable", {
      currentAssigneeName,
      sourceStaffGroup,
      targetStaffGroup,
      expectedShiftStage
    });
  }
  const dutyState = isCurrentAssigneeOnDuty({
    assigneeMember,
    sourceStaffGroup,
    scheduleData,
    config: input.config,
    now
  });
  if (dutyState.onDuty) {
    return noTransferDecision("current_assignee_on_duty", {
      currentAssigneeName,
      sourceStaffGroup,
      targetStaffGroup,
      expectedShiftStage,
      currentAssigneeShift: dutyState.shiftLabel
    });
  }

  const candidates = collectDutyCandidates({
    scheduleData,
    memberMapByUserId: input.memberMapByUserId,
    targetStaffGroup,
    expectedShiftStage
  }).filter((candidate) =>
    normalizeStaffName(candidate.member?.userId) !== normalizeStaffName(assignment.assignedToUserId)
  );

  if (candidates.length === 0) {
    return noTransferDecision("no_duty_member", {
      currentAssigneeName,
      currentAssigneeShift: dutyState.shiftLabel,
      currentAssigneeOffDutyReason: dutyState.reason,
      sourceStaffGroup,
      targetStaffGroup,
      expectedShiftStage,
      // 排班表当天该组该班次带色的名单，供日志对账“为什么没人能接”。
      coloredDutyStaffNames: listColoredStaffNamesByGroup(scheduleData, input.memberMapByUserId, targetStaffGroup)
    });
  }

  const picked = pickOnlineDutyTarget({
    candidates,
    staffGroup: targetStaffGroup
  });

  if (!picked.target) {
    if (picked.unknownStaffNames.length > 0) {
      return noTransferDecision("presence_unavailable", {
        currentAssigneeName,
        sourceStaffGroup,
        targetStaffGroup,
        expectedShiftStage,
        unknownStaffNames: picked.unknownStaffNames,
        unknownReasons: picked.unknownReasons
      });
    }

    return noTransferDecision("duty_member_offline", {
      currentAssigneeName,
      currentAssigneeShift: dutyState.shiftLabel,
      sourceStaffGroup,
      targetStaffGroup,
      expectedShiftStage,
      offlineStaffNames: picked.offlineStaffNames
    });
  }

  const targetMember = picked.target.member;
  const targetUserId = normalizeStaffName(targetMember?.userId);
  if (!targetUserId) {
    return noTransferDecision("duty_member_user_id_missing", {
      currentAssigneeName,
      sourceStaffGroup,
      targetStaffGroup,
      expectedShiftStage,
      targetStaffName: picked.target.staffName
    });
  }

  return {
    shouldTransfer: true,
    requiresAttention: false,
    reason: "eligible",
    reminderKind,
    currentAssigneeName,
    currentAssigneeOffDutyReason: dutyState.reason,
    currentAssigneeShift: dutyState.shiftLabel,
    sourceStaffGroup,
    sourceStaffGroupLabel: resolveStaffGroupLabel(sourceStaffGroup),
    targetStaffGroup,
    targetStaffGroupLabel: resolveStaffGroupLabel(targetStaffGroup),
    expectedShiftStage,
    offlineDutyStaffNames: picked.offlineStaffNames,
    targetStaffName: picked.target.staffName,
    targetUserId,
    targetBackgroundColor: picked.target.shiftInfo.backgroundColor || "",
    targetDutySource: picked.target.dutySource || "",
    targetMember
  };
}

module.exports = {
  ATTENTION_REASONS,
  AUTO_TRANSFER_REMINDER_KINDS,
  SHIFT_LABEL_BY_STAGE,
  STAFF_GROUP_LABELS,
  TRANSFER_TARGET_GROUP_BY_SOURCE_GROUP,
  decideTimeoutAutoTransfer,
  collectDutyCandidates,
  isCurrentAssigneeOnDuty,
  isDutyMarkedShift,
  isGroupLeaderRoleLabel,
  isWithinOwnShiftWindow,
  MEANINGLESS_DUTY_BACKGROUND_COLORS,
  listColoredStaffNamesByGroup,
  listDutyGroupMembers,
  listGroupLeaderDutyMembers,
  resolveStaffGroupLabel,
  resolveTargetStaffGroup
};
