const fs = require("fs");
const path = require("path");
const appConfig = require("../../config/appConfig");
const { readJsonObjectSafe } = require("../../engine/safeJson");

function ensureOnlinePresenceStateDir() {
  // 这里确保无人在线状态目录存在，避免首次运行记录扫描结果时失败。
  fs.mkdirSync(path.dirname(appConfig.onlinePresenceStatePath), { recursive: true });
}

function buildEmptyOnlinePresenceState() {
  return {
    version: 1,
    activeAbsenceKey: "",
    latestScan: null,
    remindersByAbsenceKey: {}
  };
}

function normalizeOnlinePresenceState(state) {
  // 这里只保留无人在线监控自己的状态字段，避免旧下班监控状态混进新模块。
  return {
    ...buildEmptyOnlinePresenceState(),
    activeAbsenceKey: String(state?.activeAbsenceKey || ""),
    latestScan: state?.latestScan && typeof state.latestScan === "object" ? state.latestScan : null,
    remindersByAbsenceKey:
      state?.remindersByAbsenceKey &&
      typeof state.remindersByAbsenceKey === "object" &&
      !Array.isArray(state.remindersByAbsenceKey)
        ? state.remindersByAbsenceKey
        : {}
  };
}

function readOnlinePresenceState() {
  // 这里读取无人在线持久化状态，让重启后不会对同一段无人在线重复刷群。
  ensureOnlinePresenceStateDir();
  return normalizeOnlinePresenceState(
    readJsonObjectSafe(
      appConfig.onlinePresenceStatePath,
      buildEmptyOnlinePresenceState,
      "上班监控状态"
    )
  );
}

function writeOnlinePresenceState(state) {
  // 这里用稳定 JSON 写回状态，方便现场直接打开文件核对。
  ensureOnlinePresenceStateDir();
  fs.writeFileSync(
    appConfig.onlinePresenceStatePath,
    `${JSON.stringify(normalizeOnlinePresenceState(state), null, 2)}\n`,
    "utf8"
  );
}

function createOnlinePresenceStateStore() {
  // 这里封装无人在线提醒状态，工作流只关心是否该发和扫描结果落盘。
  let state = readOnlinePresenceState();

  return {
    shouldSendAbsenceReminder(absenceKey) {
      return Boolean(absenceKey) && state.activeAbsenceKey !== absenceKey;
    },

    markAbsenceReminderSent(absenceKey, payload = {}, nowMs = Date.now()) {
      state.activeAbsenceKey = String(absenceKey || "");
      state.remindersByAbsenceKey[state.activeAbsenceKey] = {
        sentAt: new Date(nowMs).toISOString(),
        sentAtMs: nowMs,
        ...payload
      };
      writeOnlinePresenceState(state);
    },

    markPresenceRestored(payload = {}) {
      if (!state.activeAbsenceKey) {
        return false;
      }
      state.activeAbsenceKey = "";
      state.latestScan = {
        ...(state.latestScan || {}),
        scannedAt: new Date().toISOString(),
        ...payload
      };
      writeOnlinePresenceState(state);
      return true;
    },

    saveLatestScan(payload = {}) {
      state.latestScan = {
        scannedAt: new Date().toISOString(),
        ...payload
      };
      writeOnlinePresenceState(state);
    },

    getSnapshot() {
      return JSON.parse(JSON.stringify(state));
    }
  };
}

module.exports = {
  buildEmptyOnlinePresenceState,
  createOnlinePresenceStateStore,
  normalizeOnlinePresenceState,
  readOnlinePresenceState
};
