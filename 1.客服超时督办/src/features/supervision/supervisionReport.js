// 督办过程记录只供首页与排障摘要使用；绩效统计只读取独立事实账本。
const fs = require("fs");
const path = require("path");
const appConfig = require("../../config/appConfig");
const { log } = require("../../engine/logger");
const { readJsonObjectSafe } = require("../../engine/safeJson");

const MAX_RECORD_COUNT = 80;

function normalizeSupervisorReportState(state) {
  return {
    generatedAt: String(state?.generatedAt || ""),
    modeName: String(state?.modeName || ""),
    promptTrace: String(state?.promptTrace || ""),
    records: Array.isArray(state?.records) ? state.records : []
  };
}

function readSupervisorReportState() {
  if (!fs.existsSync(appConfig.supervisionProcessStatePath)) {
    return normalizeSupervisorReportState(null);
  }
  return normalizeSupervisorReportState(
    readJsonObjectSafe(appConfig.supervisionProcessStatePath, null, "督办过程记录")
  );
}

function writeSupervisorReportState(state) {
  fs.mkdirSync(path.dirname(appConfig.supervisionProcessStatePath), { recursive: true });
  const normalizedState = normalizeSupervisorReportState(state);
  normalizedState.generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  fs.writeFileSync(
    appConfig.supervisionProcessStatePath,
    JSON.stringify(normalizedState, null, 2),
    "utf8"
  );
}

function appendSupervisorProcessRecord(record) {
  const state = readSupervisorReportState();
  state.modeName = record.modeName;
  state.promptTrace = record.promptTrace;
  state.records.unshift(record);
  state.records = state.records.slice(0, MAX_RECORD_COUNT);
  writeSupervisorReportState(state);
  log("主线:执行", "过程记录", "追加处理记录", `客户=${record.customerName}，结果=${record.statusLabel}`);
}

module.exports = {
  appendSupervisorProcessRecord,
  readSupervisorReportState
};
