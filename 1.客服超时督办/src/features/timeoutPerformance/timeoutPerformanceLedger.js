// 客服超时绩效唯一事实账本：从新版本启用后只追加，不读取或迁移旧报表数据。
const fs = require("fs");
const path = require("path");
const appConfig = require("../../config/appConfig");
const {
  ASSIGNMENT_STATUS,
  normalizeAssignmentStatus,
  resolveCurrentAssignment
} = require("../shared/currentAssignment");

const writerStatesByPath = new Map();

function toLocalDayKey(timestampMs) {
  const date = new Date(Number(timestampMs));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildEmptyLedger() {
  return {
    startedAtMs: 0,
    timeoutEvents: [],
    staffObservations: []
  };
}

function normalizeStaffFields(record) {
  const assigneeUserId = String(record?.assigneeUserId || "").trim();
  const rawAssigneeName = String(record?.assigneeName || "").trim();
  const assignmentStatus = normalizeAssignmentStatus(record?.assignmentStatus, {
    assigneeUserId,
    assigneeName: rawAssigneeName
  });
  return {
    assignmentStatus,
    assigneeUserId,
    assigneeName: assignmentStatus === ASSIGNMENT_STATUS.ASSIGNED ? rawAssigneeName : "",
    assigneeRoleLabel: String(record?.assigneeRoleLabel || "").trim(),
    assigneeStaffGroup: String(record?.assigneeStaffGroup || "").trim()
  };
}

function foldTimeoutPerformanceRecords(records) {
  const ledger = buildEmptyLedger();
  const eventById = new Map();
  const openEventByChatId = new Map();
  const observationKeys = new Set();

  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== "object") {
      continue;
    }

    if (record.type === "ledger_started") {
      const startedAtMs = Number(record.startedAtMs || 0);
      if (startedAtMs > 0 && (!ledger.startedAtMs || startedAtMs < ledger.startedAtMs)) {
        ledger.startedAtMs = startedAtMs;
      }
      continue;
    }

    if (record.type === "staff_observed") {
      const observedAtMs = Number(record.observedAtMs || 0);
      const dayKey = String(record.dayKey || "").trim();
      const staffFields = normalizeStaffFields(record);
      if (staffFields.assignmentStatus !== ASSIGNMENT_STATUS.ASSIGNED) {
        continue;
      }
      const staffKey = staffFields.assigneeUserId || staffFields.assigneeName;
      const observationKey = `${dayKey}::${staffKey}`;
      if (!observedAtMs || !dayKey || !staffKey || observationKeys.has(observationKey)) {
        continue;
      }
      observationKeys.add(observationKey);
      ledger.staffObservations.push({ observedAtMs, dayKey, ...staffFields });
      continue;
    }

    if (record.type === "timeout_notified") {
      const eventId = String(record.eventId || "").trim();
      const chatId = String(record.chatId || "").trim();
      const notifiedAtMs = Number(record.notifiedAtMs || 0);
      if (!eventId || !chatId || !notifiedAtMs || eventById.has(eventId) || openEventByChatId.has(chatId)) {
        continue;
      }
      const event = {
        eventId,
        chatId,
        customerName: String(record.customerName || "未识别客户").trim() || "未识别客户",
        ...normalizeStaffFields(record),
        notifiedAtMs,
        pendingSinceAtMs: Number(record.pendingSinceAtMs || 0),
        lastCustomerMessageAtMs: Number(record.lastCustomerMessageAtMs || 0),
        thresholdAtMs: Number(record.thresholdAtMs || 0),
        thresholdSeconds: Number(record.thresholdSeconds || 0),
        webhookName: String(record.webhookName || "").trim(),
        resolvedAtMs: 0
      };
      eventById.set(eventId, event);
      openEventByChatId.set(chatId, event);
      ledger.timeoutEvents.push(event);
      continue;
    }

    if (record.type === "timeout_resolved") {
      const eventId = String(record.eventId || "").trim();
      const event = eventById.get(eventId);
      const resolvedAtMs = Number(record.resolvedAtMs || 0);
      if (!event || event.resolvedAtMs || !resolvedAtMs) {
        continue;
      }
      event.resolvedAtMs = resolvedAtMs;
      if (openEventByChatId.get(event.chatId)?.eventId === eventId) {
        openEventByChatId.delete(event.chatId);
      }
    }
  }

  Object.defineProperties(ledger, {
    eventById: { value: eventById },
    openEventByChatId: { value: openEventByChatId },
    observationKeys: { value: observationKeys }
  });
  return ledger;
}

function readLedgerRecords(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) {
    return [];
  }
  const text = fs.readFileSync(ledgerPath, "utf8");
  const records = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`客服绩效账本第 ${index + 1} 行损坏：${error.message}`);
    }
  }
  return records;
}

function loadTimeoutPerformanceLedger(ledgerPath = appConfig.timeoutPerformanceLedgerPath) {
  return foldTimeoutPerformanceRecords(readLedgerRecords(ledgerPath));
}

function appendLedgerRecord(ledgerPath, record) {
  fs.appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
}

function getWriterState(nowMs = Date.now()) {
  const ledgerPath = appConfig.timeoutPerformanceLedgerPath;
  let state = writerStatesByPath.get(ledgerPath);
  if (state) {
    return state;
  }

  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  if (!fs.existsSync(ledgerPath) || fs.statSync(ledgerPath).size === 0) {
    appendLedgerRecord(ledgerPath, { type: "ledger_started", startedAtMs: Number(nowMs) });
  }
  state = loadTimeoutPerformanceLedger(ledgerPath);
  writerStatesByPath.set(ledgerPath, state);
  return state;
}

function recordTimeoutNotification(input, nowMs = Date.now()) {
  const state = getWriterState(nowMs);
  const chatId = String(input?.chatId || "").trim();
  const pendingSinceAtMs = Number(input?.pendingSinceAtMs || input?.lastCustomerMessageAtMs || 0);
  if (!chatId || !pendingSinceAtMs) {
    throw new Error("客服绩效记账缺少 chatId 或等待起点");
  }

  const eventId = `${chatId}::${pendingSinceAtMs}`;
  const existingEvent = state.openEventByChatId.get(chatId) || state.eventById.get(eventId);
  if (existingEvent) {
    return { recorded: false, event: existingEvent };
  }

  const thresholdSeconds = Number(input?.thresholdSeconds || 0);
  const thresholdAtMs = Number(input?.thresholdAtMs || 0) || pendingSinceAtMs + thresholdSeconds * 1000;
  const record = {
    type: "timeout_notified",
    eventId,
    chatId,
    customerName: String(input?.customerName || "未识别客户").trim() || "未识别客户",
    ...normalizeStaffFields(input),
    notifiedAtMs: Number(nowMs),
    pendingSinceAtMs,
    lastCustomerMessageAtMs: Number(input?.lastCustomerMessageAtMs || pendingSinceAtMs),
    thresholdAtMs,
    thresholdSeconds,
    webhookName: String(input?.webhookName || "").trim()
  };
  appendLedgerRecord(appConfig.timeoutPerformanceLedgerPath, record);
  const event = { ...record, resolvedAtMs: 0 };
  delete event.type;
  state.timeoutEvents.push(event);
  state.eventById.set(eventId, event);
  state.openEventByChatId.set(chatId, event);
  return { recorded: true, event };
}

function recordTimeoutResolution(input) {
  const resolvedAtMs = Number(input?.resolvedAtMs || 0);
  if (!resolvedAtMs) {
    return { recorded: false, event: null };
  }
  const state = getWriterState(resolvedAtMs);
  const chatId = String(input?.chatId || "").trim();
  const event = state.openEventByChatId.get(chatId);
  if (!event) {
    return { recorded: false, event: null };
  }

  appendLedgerRecord(appConfig.timeoutPerformanceLedgerPath, {
    type: "timeout_resolved",
    eventId: event.eventId,
    chatId,
    resolvedAtMs
  });
  event.resolvedAtMs = resolvedAtMs;
  state.openEventByChatId.delete(chatId);
  return { recorded: true, event };
}

function recordActiveStaffSnapshot(contacts, memberMapByUserId, nowMs = Date.now()) {
  const state = getWriterState(nowMs);
  const dayKey = toLocalDayKey(nowMs);
  const memberMap = memberMapByUserId && typeof memberMapByUserId === "object" ? memberMapByUserId : {};
  let recordedCount = 0;

  for (const contact of Array.isArray(contacts) ? contacts : []) {
    const assignment = resolveCurrentAssignment(contact, memberMap);
    if (assignment.status !== ASSIGNMENT_STATUS.ASSIGNED) {
      continue;
    }
    const assigneeUserId = assignment.assignedToUserId;
    const member = assignment.assigneeMember;
    const assigneeName = String(member.staffName || "").trim();
    const observationKey = `${dayKey}::${assigneeUserId}`;
    if (state.observationKeys.has(observationKey)) {
      continue;
    }
    const record = {
      type: "staff_observed",
      observedAtMs: Number(nowMs),
      dayKey,
      assignmentStatus: ASSIGNMENT_STATUS.ASSIGNED,
      assigneeUserId,
      assigneeName,
      assigneeRoleLabel: String(member.roleLabel || "").trim(),
      assigneeStaffGroup: String(member.staffGroup || "").trim()
    };
    appendLedgerRecord(appConfig.timeoutPerformanceLedgerPath, record);
    state.staffObservations.push({ ...record });
    state.observationKeys.add(observationKey);
    recordedCount += 1;
  }

  return recordedCount;
}

module.exports = {
  foldTimeoutPerformanceRecords,
  loadTimeoutPerformanceLedger,
  recordActiveStaffSnapshot,
  recordTimeoutNotification,
  recordTimeoutResolution,
  toLocalDayKey
};
