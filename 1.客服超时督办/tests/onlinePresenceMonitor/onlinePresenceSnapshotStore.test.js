const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ONLINE_PRESENCE_SNAPSHOT_MAX_AGE_MS,
  isPresenceRowOnline,
  publishOnlinePresenceSnapshot,
  resetOnlinePresenceSnapshot,
  resolveOnlinePresenceRow
} = require("../../src/features/onlinePresenceMonitor/onlinePresenceSnapshotStore");

test.beforeEach(() => {
  resetOnlinePresenceSnapshot();
});

test("售前看可被转接、售后看自动分配，未开就不算在线", () => {
  assert.equal(isPresenceRowOnline({ transferEnabled: true }, "pre_sales"), true);
  assert.equal(isPresenceRowOnline({ transferEnabled: false, autoAssignEnabled: true }, "pre_sales"), false);
  assert.equal(isPresenceRowOnline({ autoAssignEnabled: true }, "after_sales"), true);
  assert.equal(isPresenceRowOnline({ autoAssignEnabled: false, transferEnabled: true }, "after_sales"), false);
  assert.equal(isPresenceRowOnline({ transferEnabled: true, autoAssignEnabled: true }, "operation"), false);
});

test("没有扫描过快照时不给任何在线依据", () => {
  const result = resolveOnlinePresenceRow("韩欢欢", "pre_sales");

  assert.equal(result.available, false);
  assert.equal(result.reason, "presence_snapshot_stale");
});

test("快照过期后不给在线依据，避免拿旧开关状态乱转", () => {
  publishOnlinePresenceSnapshot({
    rowsByStaffName: {
      韩欢欢: { staffName: "韩欢欢", staffGroup: "pre_sales", transferEnabled: true }
    }
  });

  const fresh = resolveOnlinePresenceRow("韩欢欢", "pre_sales");
  assert.equal(fresh.available, true);
  assert.equal(fresh.online, true);

  const expired = resolveOnlinePresenceRow(
    "韩欢欢",
    "pre_sales",
    Date.now() + ONLINE_PRESENCE_SNAPSHOT_MAX_AGE_MS + 1000
  );
  assert.equal(expired.available, false);
  assert.equal(expired.reason, "presence_snapshot_stale");
});

test("快照里没有这个成员时明确返回缺少该成员", () => {
  publishOnlinePresenceSnapshot({
    rowsByStaffName: {
      韩欢欢: { staffName: "韩欢欢", staffGroup: "pre_sales", transferEnabled: true }
    }
  });

  const result = resolveOnlinePresenceRow("叶炳辉", "pre_sales");

  assert.equal(result.available, false);
  assert.equal(result.reason, "presence_row_missing");
});

test("共享快照只保留自动转接需要的字段", () => {
  publishOnlinePresenceSnapshot({
    rowsByStaffName: {
      李守耀: {
        memberName: "李守耀",
        staffGroup: "after_sales",
        autoAssignEnabled: true,
        transferEnabled: false,
        currentConversationCount: 3,
        rowKey: "some-dom-key"
      }
    }
  });

  const row = resolveOnlinePresenceRow("李守耀", "after_sales").row;
  assert.deepEqual(row, {
    staffName: "李守耀",
    staffGroup: "after_sales",
    autoAssignEnabled: true,
    transferEnabled: false,
    currentConversationCount: 3
  });
});
