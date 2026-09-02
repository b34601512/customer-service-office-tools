const { formatDateKey } = require("../scheduleQuery/dailyScheduleService");
const { parseStaffRoleGroup } = require("../shared/staffIdentity");
const { resolveShiftStage } = require("../offDutyClose/offDutyConfig");

function parseMinutesOfDay(timeText) {
  // 这里把 HH:mm 转成当天分钟数，让值班窗口判断保持简单可测。
  const [hourText, minuteText] = String(timeText || "").split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`上班监控时间配置无效：${timeText}`);
  }
  return hour * 60 + minute;
}

function resolveMinutesOfDay(targetDate) {
  // 这里只取本地时间的时分，避免时区字符串转换影响现场判断。
  return targetDate.getHours() * 60 + targetDate.getMinutes();
}

function resolveLateStartTimeText(staffGroup) {
  // 这里按实际交接时间切换早晚班：售前 15:45，售后 14:00，不能再用统一的早班结束时间代替。
  if (staffGroup === "pre_sales") {
    return "15:45";
  }
  if (staffGroup === "after_sales") {
    return "14:00";
  }
  return "";
}

function resolveCloseTimeText(config, staffGroup, shiftStage) {
  // 这里按客服分组和班次拿到关闭时间，无人在线只复用时间口径，不复用下班动作。
  if (staffGroup === "pre_sales" && shiftStage === "early") {
    return config.offDutyPreSalesEarlyCloseTime;
  }
  if (staffGroup === "pre_sales" && shiftStage === "late") {
    return config.offDutyPreSalesLateCloseTime;
  }
  if (staffGroup === "after_sales" && shiftStage === "early") {
    return config.offDutyAfterSalesEarlyCloseTime;
  }
  if (staffGroup === "after_sales" && shiftStage === "late") {
    return config.offDutyAfterSalesLateCloseTime;
  }
  return "";
}

function resolveExpectedShiftStageForGroup(config, staffGroup, now = new Date()) {
  // 这里把当前时间归到早班、晚班或非值班时间，避免凌晨无上班时间时误报。
  if (!["pre_sales", "after_sales"].includes(staffGroup)) {
    return "";
  }

  const nowMinutes = resolveMinutesOfDay(now);
  const workStartMinutes = parseMinutesOfDay(config.onlinePresenceWorkStartTime || "08:00");
  const lateStartMinutes = parseMinutesOfDay(resolveLateStartTimeText(staffGroup));
  const lateCloseMinutes = parseMinutesOfDay(resolveCloseTimeText(config, staffGroup, "late"));

  if (nowMinutes < workStartMinutes || nowMinutes >= lateCloseMinutes) {
    return "";
  }
  if (nowMinutes < lateStartMinutes) {
    return "early";
  }
  return "late";
}

function normalizeScheduledShiftItem(staffName, shiftInfo, rowMap, config, now) {
  // 这里把排班和成员设置行合并成统一判断对象，规则层不直接依赖页面原始结构。
  const row = rowMap[staffName] || {};
  const staffGroup = row.staffGroup || parseStaffRoleGroup(row.roleLabel);
  const shiftStage = resolveShiftStage(shiftInfo.normalizedShift);
  return {
    staffName,
    staffGroup,
    shiftStage,
    expectedShiftStage: resolveExpectedShiftStageForGroup(config, staffGroup, now),
    row
  };
}

function listExpectedOnlineStaff(todayShiftMap, rowMap, config, now = new Date()) {
  // 这里挑出当前应值班的售前和售后客服，后续由各自的在线开关规则判断是否有人在线。
  return Object.entries(todayShiftMap || {})
    .map(([staffName, shiftInfo]) => normalizeScheduledShiftItem(staffName, shiftInfo, rowMap, config, now))
    .filter((item) => item.expectedShiftStage && item.shiftStage === item.expectedShiftStage)
    .map((item) => item.staffName);
}

function isOnlineForPresence(row, staffGroup) {
  // 这里按业务分组选择在线依据：售后看自动分配，售前看是否可被转接。
  if (staffGroup === "pre_sales") {
    return row?.transferEnabled === true;
  }
  if (staffGroup === "after_sales") {
    return row?.autoAssignEnabled === true;
  }
  return false;
}

function buildOnlinePresenceAbsenceKey(input) {
  // 这里用日期和应值班名单标记同一段无人在线状态，恢复有人在线后才会重新提醒。
  const expectedStaffNames = Array.isArray(input.expectedStaffNames) ? input.expectedStaffNames : [];
  return [
    formatDateKey(input.date || new Date()),
    "online_presence_absent",
    expectedStaffNames.slice().sort().join("/")
  ].join("::");
}

function summarizeOnlinePresenceStatus(input) {
  // 这里生成无人在线的唯一判断结果：应值班客服中有没有人开启自动分配。
  const {
    todayShiftMap,
    rowMap = {},
    readFailedStaffNames = [],
    config,
    now = new Date()
  } = input || {};
  const expectedStaffNames = listExpectedOnlineStaff(todayShiftMap, rowMap, config, now);
  const expectedByGroup = {};
  const onlineByGroup = {};
  const onlineStaffNames = [];
  const offlineStaffNames = [];

  for (const staffName of expectedStaffNames) {
    const row = rowMap[staffName];
    const staffGroup = row?.staffGroup || parseStaffRoleGroup(row?.roleLabel);
    expectedByGroup[staffGroup] ||= [];
    onlineByGroup[staffGroup] ||= [];
    expectedByGroup[staffGroup].push(staffName);

    if (isOnlineForPresence(row, staffGroup)) {
      onlineByGroup[staffGroup].push(staffName);
      onlineStaffNames.push(staffName);
    } else if (row) {
      offlineStaffNames.push(staffName);
    }
  }

  const missingStaffNames = expectedStaffNames.filter((staffName) => !rowMap[staffName]);
  const failedStaffNames = Array.isArray(readFailedStaffNames) ? readFailedStaffNames.filter(Boolean) : [];
  const canDecide = expectedStaffNames.length > 0 && missingStaffNames.length === 0 && failedStaffNames.length === 0;
  const hasOnlineCoverage = Object.keys(expectedByGroup).every(
    (staffGroup) => onlineByGroup[staffGroup].length > 0
  );

  return {
    expectedStaffNames,
    onlineStaffNames,
    offlineStaffNames,
    missingStaffNames,
    readFailedStaffNames: failedStaffNames,
    hasExpectedStaff: expectedStaffNames.length > 0,
    canDecide,
    shouldNotify: canDecide && !hasOnlineCoverage,
    absenceKey: buildOnlinePresenceAbsenceKey({
      date: now,
      expectedStaffNames
    })
  };
}

module.exports = {
  buildOnlinePresenceAbsenceKey,
  listExpectedOnlineStaff,
  parseMinutesOfDay,
  resolveExpectedShiftStageForGroup,
  summarizeOnlinePresenceStatus
};
