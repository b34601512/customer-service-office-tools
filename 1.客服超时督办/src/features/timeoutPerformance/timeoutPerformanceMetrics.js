const {
  ASSIGNMENT_STATUS,
  normalizeAssignmentStatus
} = require("../shared/currentAssignment");
const {
  resolveMissedReplyThresholdSeconds
} = require("../missedReplyMonitor/missedReplyPolicy");

const RANGE_RECENT_30 = "recent30";
const SORT_COUNT = "count";
const SORT_TOTAL = "total";

function toLocalMonthKey(timestampMs) {
  const date = new Date(Number(timestampMs));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function resolveRange(rangeKey, nowMs) {
  if (!String(rangeKey || "").startsWith("month:")) {
    return {
      key: RANGE_RECENT_30,
      label: "近30天",
      startAtMs: Number(nowMs) - 30 * 24 * 60 * 60 * 1000,
      endAtMs: Number(nowMs) + 1
    };
  }

  const monthKey = String(rangeKey).slice("month:".length);
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) {
    return resolveRange(RANGE_RECENT_30, nowMs);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return {
    key: `month:${monthKey}`,
    label: `${monthKey}整月`,
    startAtMs: new Date(year, monthIndex, 1).getTime(),
    endAtMs: new Date(year, monthIndex + 1, 1).getTime()
  };
}

function buildRangeOptions(ledger, nowMs = Date.now()) {
  const monthKeys = new Set([toLocalMonthKey(nowMs)]);
  for (const event of Array.isArray(ledger?.timeoutEvents) ? ledger.timeoutEvents : []) {
    if (Number(event.notifiedAtMs || 0) > 0) {
      monthKeys.add(toLocalMonthKey(event.notifiedAtMs));
    }
  }
  for (const observation of Array.isArray(ledger?.staffObservations) ? ledger.staffObservations : []) {
    if (Number(observation.observedAtMs || 0) > 0) {
      monthKeys.add(toLocalMonthKey(observation.observedAtMs));
    }
  }

  return [
    { key: RANGE_RECENT_30, label: "近30天" },
    ...Array.from(monthKeys)
      .sort((left, right) => right.localeCompare(left))
      .map((monthKey) => ({ key: `month:${monthKey}`, label: `${monthKey}整月` }))
  ];
}

function resolveStaffKey(item) {
  const assigneeUserId = String(item?.assigneeUserId || "").trim();
  const assigneeName = String(item?.assigneeName || "").trim();
  return assigneeUserId || (assigneeName ? `name:${assigneeName}` : "");
}

function ensureStaffRow(rowByStaffKey, item) {
  const staffKey = resolveStaffKey(item);
  if (!staffKey) {
    return null;
  }
  let row = rowByStaffKey.get(staffKey);
  if (!row) {
    row = {
      staffKey,
      assigneeUserId: String(item?.assigneeUserId || "").trim(),
      assigneeName: String(item?.assigneeName || "").trim(),
      assigneeRoleLabel: String(item?.assigneeRoleLabel || "").trim(),
      assigneeStaffGroup: String(item?.assigneeStaffGroup || "").trim(),
      timeoutCount: 0,
      totalOverdueSeconds: 0,
      activeTimeoutCount: 0,
      resolvedTimeoutCount: 0
    };
    rowByStaffKey.set(staffKey, row);
  }
  return row;
}

function resolveRecordAssignmentStatus(item) {
  return normalizeAssignmentStatus(item?.assignmentStatus, item);
}

function resolveEventOverdueSeconds(event, nowMs) {
  const startAtMs = Number(event?.thresholdAtMs || 0);
  const endAtMs = Number(event?.resolvedAtMs || 0) || Number(nowMs);
  return Math.max(0, Math.floor((endAtMs - startAtMs) / 1000));
}

function resolveEventCountedOverdueSeconds(event, nowMs) {
  // 累计衡量日常表现，单个长期漏回复最多贡献到该事件当时的漏回复阈值。
  const overdueSeconds = resolveEventOverdueSeconds(event, nowMs);
  return Math.min(
    overdueSeconds,
    resolveMissedReplyThresholdSeconds(event?.thresholdSeconds)
  );
}

function compareRows(left, right, sortKey) {
  const sortFields = sortKey === SORT_TOTAL
    ? ["totalOverdueSeconds", "timeoutCount"]
    : ["timeoutCount", "totalOverdueSeconds"];
  for (const field of sortFields) {
    const difference = Number(right[field] || 0) - Number(left[field] || 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.assigneeName.localeCompare(right.assigneeName, "zh-CN");
}

function buildTimeoutPerformanceReport(ledger, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const range = resolveRange(options.rangeKey || RANGE_RECENT_30, nowMs);
  const sortKey = [SORT_COUNT, SORT_TOTAL].includes(options.sortKey) ? options.sortKey : SORT_COUNT;
  const inRange = (timestampMs) => Number(timestampMs || 0) >= range.startAtMs && Number(timestampMs || 0) < range.endAtMs;
  const rowByStaffKey = new Map();

  for (const observation of Array.isArray(ledger?.staffObservations) ? ledger.staffObservations : []) {
    if (inRange(observation.observedAtMs) && resolveRecordAssignmentStatus(observation) === ASSIGNMENT_STATUS.ASSIGNED) {
      ensureStaffRow(rowByStaffKey, observation);
    }
  }

  const events = (Array.isArray(ledger?.timeoutEvents) ? ledger.timeoutEvents : []).filter((event) => inRange(event.notifiedAtMs));
  // 最后接待兜底的事件同样计入客服个人绩效，避免结束会话甩贵后在报表里凭空消失（ issue #621）。
  const assignedEvents = events.filter(
    (event) => [
      ASSIGNMENT_STATUS.ASSIGNED,
      ASSIGNMENT_STATUS.LAST_HANDLER
    ].includes(resolveRecordAssignmentStatus(event))
  );
  for (const event of assignedEvents) {
    const row = ensureStaffRow(rowByStaffKey, event);
    if (!row) {
      continue;
    }
    const countedOverdueSeconds = resolveEventCountedOverdueSeconds(event, nowMs);
    row.timeoutCount += 1;
    row.totalOverdueSeconds += countedOverdueSeconds;
    if (Number(event.resolvedAtMs || 0) > 0) {
      row.resolvedTimeoutCount += 1;
    } else {
      row.activeTimeoutCount += 1;
    }
  }

  const rows = Array.from(rowByStaffKey.values());
  rows.sort((left, right) => compareRows(left, right, sortKey));

  const totalOverdueSeconds = rows.reduce((sum, row) => sum + row.totalOverdueSeconds, 0);
  return {
    generatedAtMs: nowMs,
    trustedStartedAtMs: Number(ledger?.startedAtMs || 0),
    range,
    sortKey,
    rows,
    summary: {
      staffCount: rows.length,
      timeoutCount: assignedEvents.length,
      allTimeoutCount: events.length,
      unassignedTimeoutCount: events.filter(
        (event) => resolveRecordAssignmentStatus(event) === ASSIGNMENT_STATUS.UNASSIGNED
      ).length,
      memberMappingMissingTimeoutCount: events.filter(
        (event) => resolveRecordAssignmentStatus(event) === ASSIGNMENT_STATUS.MEMBER_MAPPING_MISSING
      ).length,
      totalOverdueSeconds,
      activeTimeoutCount: rows.reduce((sum, row) => sum + row.activeTimeoutCount, 0)
    }
  };
}

module.exports = {
  RANGE_RECENT_30,
  SORT_COUNT,
  SORT_TOTAL,
  buildRangeOptions,
  buildTimeoutPerformanceReport,
  resolveEventCountedOverdueSeconds,
  resolveEventOverdueSeconds,
  resolveRange,
  toLocalMonthKey
};
