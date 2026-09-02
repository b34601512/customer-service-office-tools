const {
  formatShiftForDisplay,
  parseTimeTextToDate,
  resolveOffDutyCloseTime,
  resolveOffDutyStartTime,
  resolveShiftStage
} = require("./offDutyConfig");

function formatDateKey(targetDate) {
  // 这里统一生成 YYYY-MM-DD 键，避免状态存储和日志各自拼日期导致串键。
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, "0");
  const day = String(targetDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveStaffGroup(roleLabel) {
  // 这里把页面角色文案归一到固定分组，避免后续规则直接依赖页面原文。
  const normalizedRoleLabel = String(roleLabel || "").trim();
  if (normalizedRoleLabel.includes("售前")) {
    return "pre_sales";
  }

  if (normalizedRoleLabel.includes("售后")) {
    return "after_sales";
  }

  if (normalizedRoleLabel.includes("运营")) {
    return "operation";
  }

  if (normalizedRoleLabel.includes("经理")) {
    return "management";
  }

  return "unknown";
}

function buildOffDutyActionKey(targetDate, staffName, shiftLabel) {
  // 这里统一构造下班动作唯一键，保证同一天同一人只会被完整收尾一次。
  return `${formatDateKey(targetDate)}::${String(staffName || "").trim()}::${formatShiftForDisplay(shiftLabel)}`;
}

function buildOffDutyCompletionNoticeKey(targetDate, staffName) {
  // 这里单独构造完成通知键，保证同一天同一人只会发一次收尾群消息。
  return `${formatDateKey(targetDate)}::${String(staffName || "").trim()}::off_duty_closed_notice`;
}

function buildOffDutyCandidate(input) {
  // 这里把单个客服的下班资格压成标准对象，避免工作流层直接拼业务规则。
  const {
    now,
    shiftDate,
    config,
    row,
    todayShiftMap,
    tomorrowShiftMap
  } = input;
  const todayShift = todayShiftMap[row.memberName];
  if (!todayShift) {
    return null;
  }

  const shiftLabel = todayShift.normalizedShift;
  const shiftStage = resolveShiftStage(shiftLabel);
  if (!["early", "late"].includes(shiftStage)) {
    return null;
  }

  const staffGroup = row.staffGroup || resolveStaffGroup(row.roleLabel);
  if (!["pre_sales", "after_sales"].includes(staffGroup)) {
    return null;
  }

  const closeTimeText = resolveOffDutyCloseTime(config, staffGroup, shiftLabel);
  if (!closeTimeText) {
    return null;
  }

  const startTimeText = resolveOffDutyStartTime(config, staffGroup, shiftLabel);
  if (!startTimeText) {
    return null;
  }

  const scheduleDate = shiftDate instanceof Date ? shiftDate : now;
  const startAt = parseTimeTextToDate(scheduleDate, startTimeText);
  const closeAt = parseTimeTextToDate(scheduleDate, closeTimeText);
  const beforeShiftStart = now.getTime() < startAt.getTime();
  const afterShiftEnd = now.getTime() >= closeAt.getTime();
  if (!beforeShiftStart && !afterShiftEnd) {
    return null;
  }

  const tomorrowShift = tomorrowShiftMap[row.memberName];
  const candidate = {
    actionKey: buildOffDutyActionKey(scheduleDate, row.memberName, shiftLabel),
    startAt,
    startTimeText,
    closeAt,
    closeTimeText,
    currentConversationCount: Number(row.currentConversationCount || 0),
    memberName: row.memberName,
    roleLabel: row.roleLabel,
    rowKey: row.rowKey,
    shiftLabel,
    shiftStage,
    staffGroup,
    staffName: row.memberName,
    silentClose: beforeShiftStart,
    tomorrowShiftLabel: formatShiftForDisplay(tomorrowShift ? tomorrowShift.normalizedShift : ""),
    workflowKind: "close_only"
  };

  return candidate;
}

function listScheduledOffDutyStaffNames(shiftMap, excludedStaffNames = new Set()) {
  // 这里优先保护今天仍在上班的客服，昨天补检查时不能动他们当前正在使用的开关和会话。
  const excludedNames = excludedStaffNames instanceof Set
    ? excludedStaffNames
    : new Set(excludedStaffNames || []);

  return Object.entries(shiftMap || {})
    .filter(([staffName, shiftInfo]) =>
      ["早班", "晚班"].includes(shiftInfo.normalizedShift) && !excludedNames.has(staffName)
    )
    .map(([staffName]) => staffName);
}

function buildTodayShiftMapForPolicy(shiftMap, rowMap = {}) {
  // 这里把排班映射补上客服分组，方便纯规则函数只收一个 todayShiftMap 参数。
  const result = {};

  for (const [staffName, shiftInfo] of Object.entries(shiftMap || {})) {
    const row = rowMap[staffName] || {};
    result[staffName] = {
      staffName,
      normalizedShift: shiftInfo.normalizedShift,
      rawShift: shiftInfo.rawShift,
      shiftStage: resolveShiftStage(shiftInfo.normalizedShift),
      staffGroup: row.staffGroup || resolveStaffGroup(row.roleLabel)
    };
  }

  return result;
}

module.exports = {
  buildOffDutyActionKey,
  buildOffDutyCompletionNoticeKey,
  buildOffDutyCandidate,
  buildTodayShiftMapForPolicy,
  listScheduledOffDutyStaffNames,
  formatDateKey,
  resolveStaffGroup
};
