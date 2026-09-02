const fs = require("fs");
const path = require("path");
const appConfig = require("../../config/appConfig");
const { readJsonObjectSafe } = require("../../engine/safeJson");

function ensureStateDir() {
  // 这里统一确保下班状态目录存在，避免首次运行时写状态文件直接失败。
  fs.mkdirSync(path.dirname(appConfig.offDutyStatePath), { recursive: true });
}

function buildEmptyState() {
  return {
    version: 1,
    completedActions: {},
    completionNotices: {}
  };
}

function readState() {
  // 这里统一读取持久化状态，让重启后也不会重复关同一个人或疯狂刷提醒。
  ensureStateDir();
  if (!fs.existsSync(appConfig.offDutyStatePath)) {
    return buildEmptyState();
  }

  const parsedState = readJsonObjectSafe(appConfig.offDutyStatePath, buildEmptyState, "下班监控状态");
  return {
    version: Number(parsedState.version || 1),
    completedActions: parsedState.completedActions || {},
    completionNotices: parsedState.completionNotices || {}
  };
}

function writeState(state) {
  // 这里统一按稳定 JSON 落盘，方便人工排查今天到底做过哪些动作。
  ensureStateDir();
  fs.writeFileSync(appConfig.offDutyStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function createOffDutyStateStore() {
  // 这里把下班动作状态收口成小型状态仓库，工作流只关心读写接口。
  let state = readState();

  return {
    isActionCompleted(actionKey) {
      return Boolean(state.completedActions[actionKey]);
    },

    getActionCompletion(actionKey) {
      return state.completedActions[actionKey] || null;
    },

    markActionCompleted(actionKey, payload = {}) {
      state.completedActions[actionKey] = {
        completedAt: new Date().toISOString(),
        ...payload
      };
      writeState(state);
    },

    clearActionCompleted(actionKey) {
      if (!state.completedActions[actionKey]) {
        return;
      }

      delete state.completedActions[actionKey];
      writeState(state);
    },

    hasCompletionNotice(noticeKey) {
      return Boolean(state.completionNotices[noticeKey]);
    },

    getCompletionNotice(noticeKey) {
      return state.completionNotices[noticeKey] || null;
    },

    markCompletionNoticeSent(noticeKey, payload = {}, nowMs = Date.now()) {
      state.completionNotices[noticeKey] = {
        sentAt: new Date(nowMs).toISOString(),
        sentAtMs: nowMs,
        ...payload
      };
      writeState(state);
    },

    getSnapshot() {
      return JSON.parse(JSON.stringify(state));
    }
  };
}

module.exports = {
  createOffDutyStateStore
};
