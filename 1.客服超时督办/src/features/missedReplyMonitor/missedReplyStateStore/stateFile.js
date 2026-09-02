// 该文件用于读写漏回复监控状态文件。
const fs = require("fs");
const path = require("path");
const appConfig = require("../../../config/appConfig");
const { readJsonObjectSafe } = require("../../../engine/safeJson");
const { buildEmptyMissedReplyMonitorState } = require("./stateShape");
const { normalizeMissedReplyMonitorState } = require("./stateNormalizer");

function ensureMissedReplyMonitorStateDir() {
  // 这里统一确保未实质回复状态目录存在，避免第一次循环提醒落盘失败。
  fs.mkdirSync(path.dirname(appConfig.missedReplyMonitorStatePath), { recursive: true });
}

function readMissedReplyMonitorState() {
  // 这里统一读取未实质回复循环提醒状态，让程序重启后不会同一事件重复刷屏。
  ensureMissedReplyMonitorStateDir();
  return normalizeMissedReplyMonitorState(
    readJsonObjectSafe(
      appConfig.missedReplyMonitorStatePath,
      buildEmptyMissedReplyMonitorState,
      "漏回复监控状态"
    )
  );
}

function writeMissedReplyMonitorState(state) {
  // 这里统一持久化提醒事件进度，落盘时只写新结构，避免新旧状态混用。
  ensureMissedReplyMonitorStateDir();
  const normalizedState = normalizeMissedReplyMonitorState(state);
  normalizedState.updatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  fs.writeFileSync(
    appConfig.missedReplyMonitorStatePath,
    JSON.stringify(normalizedState, null, 2),
    "utf8"
  );
}

module.exports = {
  ensureMissedReplyMonitorStateDir,
  readMissedReplyMonitorState,
  writeMissedReplyMonitorState
};
