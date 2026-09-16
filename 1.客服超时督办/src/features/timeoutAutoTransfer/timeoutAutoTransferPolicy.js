// 该文件只负责裁决“这条超时/漏回复提醒该不该自动转接、转给谁”，不依赖页面或接口写入。
// 口径（2026-09-16 用户确认，已简化到最朴素的一条）：客户消息必须有人回。
//   1) 原接待还在自己班次时间窗内**且已上线** → 不转（他自己的客户自己跟）；
//      “在班但没上线”同样算没人管（用户 2026-09-16 拍板：“在班，但是没上线当然也算是没人管，直接转给当班在线的人就行”）；
//   2) 确属没人管 → 运营转售前、售前转售前、售后转售后，绝不跨组；
//   3) 目标是“当班 + 已上线”的同组客服，不看值班标记/组长/背景色，谁当班在线谁就能接；
//   4) 当班的人都不可接 → 不转（转了没人回），@主管让他安排。
const { ASSIGNMENT_STATUS } = require("../shared/currentAssignment");
const {
  parseTimeTextToDate,
  resolveOffDutyCloseTime,
  resolveOffDutyStartTime,
  resolveShiftStage
} = require("../offDutyClose/offDutyConfig");
const { resolveExpectedShiftStageForGroup } = require("../onlinePresenceMonitor/onlinePresencePolicy");
const { resolveOnlinePresenceRow } = require("../onlinePresenceMonitor/onlinePresenceSnapshotStore");

const AUTO_TRANSFER_REMINDER_KINDS = new Set(["timeout", "missedReply", "shiftHandover"]);

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

// 运营账号不负责接待，客户按售前口径处理；其余同组流转。
const TRANSFER_TARGET_GROUP_BY_SOURCE_GROUP = Object.freeze({
  after_sales: "after_sales",
  operation: "pre_sales",
  pre_sales: "pre_sales"
});

// 命中这些原因说明“客户当前确实没人能接手”，必须让主管知道，不能静默跳过。
const ATTENTION_REASONS = new Set(["no_on_shift_member", "on_shift_member_offline"]);

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

function isWithinOwnShiftWindow(config, staffGroup, shiftLabel, now) {
  // “当班”＝当前时刻落在本人班次的时间窗内（早班 8:00~16:30，晚班 15:45/14:00~23:45/22:30）。
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

function resolveTargetStaffGroup(assigneeMember) {
  // 成员角色缺失（未识别/经理等）时不做猜测，直接不转。
  const sourceStaffGroup = normalizeStaffName(assigneeMember?.staffGroup);
  return {
    sourceStaffGroup,
    targetStaffGroup: TRANSFER_TARGET_GROUP_BY_SOURCE_GROUP[sourceStaffGroup] || ""
  };
}

function resolveSourceAvailabilityLabel(offDutyReason) {
  // 通知文案要说清楚“原接待当时到底怎么了”，不然主管看不出该不该找当事人。
  if (offDutyReason === "shift_on_duty_but_offline") {
    return "当时在班但没上线（没开接单开关）";
  }
  if (offDutyReason === "shift_on_duty_presence_unknown") {
    return "当时在班但查不到在线状态";
  }
  return "当时不在自己班次内";
}

function isCurrentAssigneeOnDuty(input) {
  // 运营不参与排班值班，一律视为没人管；售前/售后看本人班次时间窗 + 是否真的上线。
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

  const currentTime = now instanceof Date ? now : new Date(now || Date.now());
  const presence = resolveOnlinePresenceRow(staffName, sourceStaffGroup, currentTime.getTime());
  if (!presence.available) {
    // 在线状态查不到时不擅自转走客户，宁可维持现状。
    return { onDuty: true, reason: "shift_on_duty_presence_unknown", shiftLabel };
  }
  if (!presence.online) {
    // 在班但没上线（没开接单开关）＝没人管，客户要转给当班在线的人。
    return { onDuty: false, reason: "shift_on_duty_but_offline", shiftLabel };
  }

  return { onDuty: true, reason: "on_shift_now", shiftLabel };
}

function listOnShiftGroupMembers(input) {
  // 可接手名单：同组、当天排早/晚班、本人班次时间窗覆盖当前时刻的人（含非值班/无背景色的人），
  // 顺序沿用排班表从上到下。休息/年假/行政不属于任何班次，直接不进名单。
  const { scheduleData, memberMapByUserId, staffGroup, config, now } = input;
  if (!staffGroup) {
    return [];
  }

  const members = Object.values(memberMapByUserId || {});
  return Object.entries(scheduleData?.shiftMap || {})
    .filter(([, shiftInfo]) => {
      const shiftLabel = String(shiftInfo?.normalizedShift || "").trim();
      if (!["early", "late"].includes(resolveShiftStage(shiftLabel))) {
        return false;
      }
      return isWithinOwnShiftWindow(config, staffGroup, shiftLabel, now);
    })
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
            shiftInfo
          }
        : null;
    })
    .filter(Boolean);
}

function listGroupShiftOverview(scheduleData, memberMapByUserId, staffGroup) {
  // 诊断用：一眼看出“今天这个组谁排了什么班”，排障时不用再去翻排班表。
  if (!staffGroup) {
    return [];
  }

  const members = Object.values(memberMapByUserId || {});
  return Object.entries(scheduleData?.shiftMap || {})
    .map(([staffName, shiftInfo]) => {
      const normalizedStaffName = normalizeStaffName(staffName);
      const member = members.find((item) =>
        normalizeStaffName(item?.staffName) === normalizedStaffName &&
        item?.staffGroup === staffGroup
      );
      return member ? `${normalizedStaffName}(${shiftInfo?.normalizedShift || "-"})` : null;
    })
    .filter(Boolean);
}

function pickOnlineTarget(input) {
  // 当班但没开接单开关＝没上线，用户口径明确：不在线不能转，转了没人回复。
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
    // 非工作时段没人值班是很正常的，不转也不打扰主管。
    return noTransferDecision("outside_target_group_work_time", {
      currentAssigneeName,
      sourceStaffGroup,
      targetStaffGroup
    });
  }

  const scheduleData = input.scheduleData;
  if (!scheduleData?.shiftMap || Object.keys(scheduleData.shiftMap).length === 0) {
    // 排班表读不到就没有“谁当班”的依据，宁可不转也不乱转。
    return noTransferDecision("schedule_unavailable", {
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
      currentAssigneeShift: dutyState.shiftLabel,
      // 在班且在线的判定依据，供日志对账（含“在线状态查不到”这种情况）。
      currentAssigneeOnDutyReason: dutyState.reason
    });
  }

  const candidates = listOnShiftGroupMembers({
    scheduleData,
    memberMapByUserId: input.memberMapByUserId,
    staffGroup: targetStaffGroup,
    config: input.config,
    now
  }).filter((candidate) =>
    normalizeStaffName(candidate.member?.userId) !== normalizeStaffName(assignment.assignedToUserId)
  );

  if (candidates.length === 0) {
    return noTransferDecision("no_on_shift_member", {
      currentAssigneeName,
      currentAssigneeShift: dutyState.shiftLabel,
      currentAssigneeOffDutyReason: dutyState.reason,
      sourceStaffGroup,
      targetStaffGroup,
      expectedShiftStage,
      // 当天该组的排班全貌，供日志对账“为什么没人能接”。
      groupShiftOverview: listGroupShiftOverview(scheduleData, input.memberMapByUserId, targetStaffGroup)
    });
  }

  const picked = pickOnlineTarget({
    candidates,
    staffGroup: targetStaffGroup
  });

  if (!picked.target) {
    if (picked.offlineStaffNames.length === 0 && picked.unknownStaffNames.length > 0) {
      // 快照过期/缺人，一条“确认离线”的证据都没有：不擅自转，也不惊动主管。
      return noTransferDecision("presence_unavailable", {
        currentAssigneeName,
        sourceStaffGroup,
        targetStaffGroup,
        expectedShiftStage,
        unknownStaffNames: picked.unknownStaffNames,
        unknownReasons: picked.unknownReasons
      });
    }

    return noTransferDecision("on_shift_member_offline", {
      currentAssigneeName,
      currentAssigneeShift: dutyState.shiftLabel,
      sourceStaffGroup,
      targetStaffGroup,
      expectedShiftStage,
      offlineStaffNames: picked.offlineStaffNames,
      unknownStaffNames: picked.unknownStaffNames
    });
  }

  const targetMember = picked.target.member;
  const targetUserId = normalizeStaffName(targetMember?.userId);
  if (!targetUserId) {
    return noTransferDecision("on_shift_member_user_id_missing", {
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
    expectedShiftLabel: SHIFT_LABEL_BY_STAGE[expectedShiftStage] || "",
    // 当班但没上线、被跳过的人，仅用于日志审计。
    offlineStaffNames: picked.offlineStaffNames,
    targetStaffName: picked.target.staffName,
    targetUserId,
    targetShiftLabel: String(picked.target.shiftInfo?.normalizedShift || "").trim(),
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
  isCurrentAssigneeOnDuty,
  isWithinOwnShiftWindow,
  listGroupShiftOverview,
  listOnShiftGroupMembers,
  pickOnlineTarget,
  resolveSourceAvailabilityLabel,
  resolveStaffGroupLabel,
  resolveTargetStaffGroup
};
