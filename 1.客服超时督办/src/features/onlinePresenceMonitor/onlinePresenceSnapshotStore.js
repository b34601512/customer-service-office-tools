// 该文件在同一个进程内共享「上班监控」每轮读到的成员开关快照，供超时自动转接判断目标客服是否真的在线。
// 只共享内存不落盘：进程重启后必须先有一轮上班扫描，才允许自动转接挑人。
const ONLINE_PRESENCE_SNAPSHOT_MAX_AGE_MS = 90000;

let latestSnapshot = {
  updatedAtMs: 0,
  scannedAt: "",
  rowsByStaffName: {}
};

function normalizeSnapshotRow(row) {
  // 这里只保留自动转接需要的字段，避免把页面原始结构泄漏给规则层。
  return {
    staffName: String(row?.memberName || row?.staffName || "").trim(),
    staffGroup: String(row?.staffGroup || "").trim(),
    autoAssignEnabled: row?.autoAssignEnabled === true,
    transferEnabled: row?.transferEnabled === true,
    currentConversationCount: Number(row?.currentConversationCount || 0)
  };
}

function publishOnlinePresenceSnapshot(input = {}) {
  // 上班监控每轮扫描完成后调用，把这一轮读到的真实开关状态登记为当前快照。
  const rowsByStaffName = {};
  for (const [staffName, row] of Object.entries(input.rowsByStaffName || {})) {
    const normalizedStaffName = String(staffName || "").trim();
    if (!normalizedStaffName || !row) {
      continue;
    }

    rowsByStaffName[normalizedStaffName] = normalizeSnapshotRow({
      ...row,
      staffName: row.staffName || normalizedStaffName
    });
  }

  latestSnapshot = {
    updatedAtMs: Date.now(),
    scannedAt: String(input.scannedAt || new Date().toISOString()),
    rowsByStaffName
  };
  return latestSnapshot;
}

function readOnlinePresenceSnapshot() {
  // 只读访问用于日志与验收，调用方不得直接改这份内存对象。
  return latestSnapshot;
}

function resetOnlinePresenceSnapshot() {
  // 仅测试与排查使用：清空后自动转接会按“无在线依据”处理，不会乱转。
  latestSnapshot = {
    updatedAtMs: 0,
    scannedAt: "",
    rowsByStaffName: {}
  };
  return latestSnapshot;
}

function isPresenceRowOnline(row, staffGroup) {
  // 售前看「是否可被转接」，售后看「自动分配」，与上班监控的在线口径保持一致。
  if (staffGroup === "pre_sales") {
    return row?.transferEnabled === true;
  }
  if (staffGroup === "after_sales") {
    return row?.autoAssignEnabled === true;
  }
  return false;
}

function resolveOnlinePresenceRow(staffName, staffGroup, nowMs = Date.now()) {
  // 这里统一给出“能不能拿这份快照作依据”的结论，过期或没有该成员一律判为不可用。
  const normalizedStaffName = String(staffName || "").trim();
  if (!normalizedStaffName) {
    return { available: false, reason: "presence_staff_name_missing", row: null, ageMs: 0 };
  }

  const snapshot = latestSnapshot;
  const ageMs = snapshot.updatedAtMs ? nowMs - snapshot.updatedAtMs : Infinity;
  if (!snapshot.updatedAtMs || ageMs > ONLINE_PRESENCE_SNAPSHOT_MAX_AGE_MS) {
    return { available: false, reason: "presence_snapshot_stale", row: null, ageMs };
  }

  const row = snapshot.rowsByStaffName[normalizedStaffName] || null;
  if (!row) {
    return { available: false, reason: "presence_row_missing", row: null, ageMs };
  }

  return {
    available: true,
    reason: "",
    row,
    ageMs,
    online: isPresenceRowOnline(row, staffGroup)
  };
}

module.exports = {
  ONLINE_PRESENCE_SNAPSHOT_MAX_AGE_MS,
  isPresenceRowOnline,
  publishOnlinePresenceSnapshot,
  readOnlinePresenceSnapshot,
  resetOnlinePresenceSnapshot,
  resolveOnlinePresenceRow
};
