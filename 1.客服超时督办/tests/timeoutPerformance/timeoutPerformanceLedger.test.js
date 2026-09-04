const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const appConfig = require("../../src/config/appConfig");
const {
  foldTimeoutPerformanceRecords,
  loadTimeoutPerformanceLedger,
  recordActiveStaffSnapshot,
  recordTimeoutNotification,
  recordTimeoutResolution
} = require("../../src/features/timeoutPerformance/timeoutPerformanceLedger");
const {
  buildRangeOptions,
  buildTimeoutPerformanceReport
} = require("../../src/features/timeoutPerformance/timeoutPerformanceMetrics");

const ORIGINAL_LEDGER_PATH = appConfig.timeoutPerformanceLedgerPath;

function useTempLedger(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "timeout-performance-"));
  appConfig.timeoutPerformanceLedgerPath = path.join(rootDir, "ledger.jsonl");
  t.after(() => {
    appConfig.timeoutPerformanceLedgerPath = ORIGINAL_LEDGER_PATH;
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
}

function buildNotification(overrides = {}) {
  return {
    chatId: "chat_1",
    customerName: "客户甲",
    assigneeUserId: "staff_a",
    assigneeName: "客服甲",
    assigneeRoleLabel: "售后客服",
    pendingSinceAtMs: 1800000000000,
    lastCustomerMessageAtMs: 1800000000000,
    thresholdAtMs: 1800000300000,
    thresholdSeconds: 300,
    webhookName: "售后通知群",
    ...overrides
  };
}

test("绩效账本只记新事实，并按等待轮次去重后记录实质回复时间", (t) => {
  useTempLedger(t);
  const first = recordTimeoutNotification(buildNotification(), 1800000310000);
  const duplicate = recordTimeoutNotification(
    buildNotification({ pendingSinceAtMs: 1800000010000 }),
    1800000320000
  );
  const resolution = recordTimeoutResolution({ chatId: "chat_1", resolvedAtMs: 1800000600000 });
  const second = recordTimeoutNotification(
    buildNotification({ pendingSinceAtMs: 1800000700000, thresholdAtMs: 1800001000000 }),
    1800001010000
  );

  assert.equal(first.recorded, true);
  assert.equal(duplicate.recorded, false);
  assert.equal(resolution.recorded, true);
  assert.equal(second.recorded, true);

  const ledger = loadTimeoutPerformanceLedger();
  assert.equal(ledger.startedAtMs, 1800000310000);
  assert.equal(ledger.timeoutEvents.length, 2);
  assert.equal(ledger.timeoutEvents[0].resolvedAtMs, 1800000600000);
  assert.equal(ledger.timeoutEvents[1].resolvedAtMs, 0);
});

test("在岗客服每天只观察一次，零超时客服也进入对比", (t) => {
  useTempLedger(t);
  const contacts = [
    { assignedToUserId: "staff_a" },
    { assignedToUserId: "staff_a" },
    { assignedToUserId: "staff_b" }
  ];
  const members = {
    staff_a: { userId: "staff_a", staffName: "客服甲", roleLabel: "售后客服" },
    staff_b: { userId: "staff_b", staffName: "客服乙", roleLabel: "售前客服" }
  };
  const nowMs = new Date(2026, 7, 27, 10, 0, 0).getTime();

  assert.equal(recordActiveStaffSnapshot(contacts, members, nowMs), 2);
  assert.equal(recordActiveStaffSnapshot(contacts, members, nowMs + 60 * 1000), 0);

  const report = buildTimeoutPerformanceReport(loadTimeoutPerformanceLedger(), { nowMs });
  assert.deepEqual(report.rows.map((row) => row.assigneeName), ["客服甲", "客服乙"]);
  assert.ok(report.rows.every((row) => row.timeoutCount === 0));
});

test("近30天与自然月按提醒入群时间筛选", () => {
  const augustEventAt = new Date(2026, 7, 5, 12, 0, 0).getTime();
  const julyEventAt = new Date(2026, 6, 15, 12, 0, 0).getTime();
  const nowMs = new Date(2026, 7, 27, 12, 0, 0).getTime();
  const ledger = foldTimeoutPerformanceRecords([
    { type: "ledger_started", startedAtMs: julyEventAt },
    { type: "timeout_notified", eventId: "aug", chatId: "aug", notifiedAtMs: augustEventAt, thresholdAtMs: augustEventAt - 10000, thresholdSeconds: 300, assigneeUserId: "a", assigneeName: "客服甲" },
    { type: "timeout_resolved", eventId: "aug", chatId: "aug", resolvedAtMs: augustEventAt + 10000 },
    { type: "timeout_notified", eventId: "jul", chatId: "jul", notifiedAtMs: julyEventAt, thresholdAtMs: julyEventAt - 10000, thresholdSeconds: 300, assigneeUserId: "b", assigneeName: "客服乙" },
    { type: "timeout_resolved", eventId: "jul", chatId: "jul", resolvedAtMs: julyEventAt + 10000 }
  ]);

  assert.equal(buildTimeoutPerformanceReport(ledger, { nowMs }).summary.timeoutCount, 1);
  assert.equal(buildTimeoutPerformanceReport(ledger, { nowMs, rangeKey: "month:2026-07" }).summary.timeoutCount, 1);
  assert.equal(buildTimeoutPerformanceReport(ledger, { nowMs, rangeKey: "month:2026-08" }).summary.timeoutCount, 1);
  assert.deepEqual(buildRangeOptions(ledger, nowMs).map((item) => item.key), [
    "recent30",
    "month:2026-08",
    "month:2026-07"
  ]);
});

test("客服对比支持次数、累计时长两种最差优先排序", () => {
  const nowMs = new Date(2026, 7, 27, 12, 0, 0).getTime();
  const base = nowMs - 100000;
  const ledger = foldTimeoutPerformanceRecords([
    { type: "ledger_started", startedAtMs: base },
    { type: "timeout_notified", eventId: "a1", chatId: "a1", notifiedAtMs: base, thresholdAtMs: base - 10000, thresholdSeconds: 300, assigneeUserId: "a", assigneeName: "客服甲" },
    { type: "timeout_resolved", eventId: "a1", resolvedAtMs: base + 10000 },
    { type: "timeout_notified", eventId: "a2", chatId: "a2", notifiedAtMs: base + 1, thresholdAtMs: base - 5000, thresholdSeconds: 300, assigneeUserId: "a", assigneeName: "客服甲" },
    { type: "timeout_resolved", eventId: "a2", resolvedAtMs: base + 15000 },
    { type: "timeout_notified", eventId: "b1", chatId: "b1", notifiedAtMs: base + 2, thresholdAtMs: base - 10000, thresholdSeconds: 300, assigneeUserId: "b", assigneeName: "客服乙" },
    { type: "timeout_resolved", eventId: "b1", resolvedAtMs: base + 50000 }
  ]);

  assert.equal(buildTimeoutPerformanceReport(ledger, { nowMs, sortKey: "count" }).rows[0].assigneeName, "客服甲");
  assert.equal(buildTimeoutPerformanceReport(ledger, { nowMs, sortKey: "total" }).rows[0].assigneeName, "客服乙");
});

test("累计超时按各事件漏回复阈值封顶", () => {
  const nowMs = new Date(2026, 7, 27, 12, 0, 0).getTime();
  const base = nowMs - 4 * 60 * 60 * 1000;
  const ledger = foldTimeoutPerformanceRecords([
    { type: "ledger_started", startedAtMs: base },
    { type: "timeout_notified", eventId: "a1", chatId: "a1", notifiedAtMs: base + 1, thresholdAtMs: base, thresholdSeconds: 150, assigneeUserId: "a", assigneeName: "客服甲" },
    { type: "timeout_resolved", eventId: "a1", resolvedAtMs: base + 3 * 60 * 60 * 1000 },
    { type: "timeout_notified", eventId: "b1", chatId: "b1", notifiedAtMs: base + 2, thresholdAtMs: base, thresholdSeconds: 150, assigneeUserId: "b", assigneeName: "客服乙" },
    { type: "timeout_resolved", eventId: "b1", resolvedAtMs: base + 20 * 60 * 1000 },
    { type: "timeout_notified", eventId: "b2", chatId: "b2", notifiedAtMs: base + 3, thresholdAtMs: base, thresholdSeconds: 150, assigneeUserId: "b", assigneeName: "客服乙" },
    { type: "timeout_resolved", eventId: "b2", resolvedAtMs: base + 20 * 60 * 1000 }
  ]);

  const report = buildTimeoutPerformanceReport(ledger, { nowMs, sortKey: "total" });
  const staffA = report.rows.find((row) => row.assigneeName === "客服甲");
  const staffB = report.rows.find((row) => row.assigneeName === "客服乙");

  assert.equal(staffA.totalOverdueSeconds, 25 * 60);
  assert.equal(staffB.totalOverdueSeconds, 40 * 60);
  assert.equal(report.summary.totalOverdueSeconds, 65 * 60);
  assert.equal(report.rows[0].assigneeName, "客服乙");
});

test("未分配和成员映射缺失应该单独计数，不进入个人绩效", () => {
  const nowMs = new Date(2026, 7, 27, 12, 0, 0).getTime();
  const base = nowMs - 100000;
  const ledger = foldTimeoutPerformanceRecords([
    { type: "ledger_started", startedAtMs: base },
    { type: "timeout_notified", eventId: "assigned", chatId: "assigned", notifiedAtMs: base, thresholdAtMs: base - 10000, thresholdSeconds: 300, assignmentStatus: "assigned", assigneeUserId: "a", assigneeName: "客服甲" },
    { type: "timeout_notified", eventId: "unassigned", chatId: "unassigned", notifiedAtMs: base + 1, thresholdAtMs: base - 10000, thresholdSeconds: 300, assignmentStatus: "unassigned", assigneeUserId: "", assigneeName: "" },
    { type: "timeout_notified", eventId: "mapping", chatId: "mapping", notifiedAtMs: base + 2, thresholdAtMs: base - 10000, thresholdSeconds: 300, assignmentStatus: "member_mapping_missing", assigneeUserId: "unknown", assigneeName: "" }
  ]);

  const report = buildTimeoutPerformanceReport(ledger, { nowMs });
  assert.deepEqual(report.rows.map((row) => row.assigneeName), ["客服甲"]);
  assert.equal(report.summary.timeoutCount, 1);
  assert.equal(report.summary.allTimeoutCount, 3);
  assert.equal(report.summary.unassignedTimeoutCount, 1);
  assert.equal(report.summary.memberMappingMissingTimeoutCount, 1);
});
