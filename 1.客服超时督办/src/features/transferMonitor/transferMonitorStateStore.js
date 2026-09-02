const fs = require("fs");
const path = require("path");
const appConfig = require("../../config/appConfig");
const { readJsonObjectSafe } = require("../../engine/safeJson");

function buildEmptyTransferMonitorState() {
  return {
    updatedAt: "",
    contactsByChatId: {}
  };
}

function ensureTransferMonitorStateDir() {
  // 这里统一确保转接状态目录存在，避免第一次落盘时因为目录不存在而失败。
  fs.mkdirSync(path.dirname(appConfig.transferMonitorStatePath), { recursive: true });
}

function readTransferMonitorState() {
  // 这里统一读取独立转接监控快照，仅供排障和测试使用，启动判断不再读取历史基线。
  ensureTransferMonitorStateDir();
  return readJsonObjectSafe(
    appConfig.transferMonitorStatePath,
    buildEmptyTransferMonitorState,
    "转接监控状态"
  );
}

function writeTransferMonitorState(state) {
  // 这里统一持久化当前联系人分配快照，方便排查当时监控看到的真实接待状态。
  ensureTransferMonitorStateDir();
  const normalizedState = {
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    contactsByChatId:
      state?.contactsByChatId && typeof state.contactsByChatId === "object"
        ? state.contactsByChatId
        : {}
  };
  fs.writeFileSync(appConfig.transferMonitorStatePath, JSON.stringify(normalizedState, null, 2), "utf8");
}

module.exports = {
  buildEmptyTransferMonitorState,
  readTransferMonitorState,
  writeTransferMonitorState
};
