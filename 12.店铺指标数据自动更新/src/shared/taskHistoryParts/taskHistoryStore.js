const fs = require("fs");
const appConfig = require("../../config/appConfig");
const { writeJsonFileAtomic, readJsonFile } = require("../fileStore");
const { normalizeTaskHistoryRecord } = require("./taskHistoryRecordNormalizer");

const TASK_HISTORY_RECORD_LIMIT = 200;

function resolveTaskHistoryPath() {
  // 这个函数每次读取运行路径，避免测试或运行时切换历史文件后被模块缓存污染。
  return process.env.STORE_METRIC_TASK_HISTORY_PATH ||
    process.env.CUSTOMER_PERFORMANCE_HISTORY_PATH || appConfig.taskHistoryPath;
}

function createEmptyTaskHistory() {
  // 这个函数只创建统一的空历史结构。
  return { downloads: [], imports: [], storeMetricRuns: [] };
}

function readTaskHistory() {
  // 这个函数只从唯一历史文件读取并规范化下载与导入记录。
  const historyPath = resolveTaskHistoryPath();
  if (!fs.existsSync(historyPath)) {
    return createEmptyTaskHistory();
  }
  const payload = readJsonFile(historyPath, "运行历史");
  return {
    downloads: Array.isArray(payload.downloads) ? payload.downloads.map(normalizeTaskHistoryRecord) : [],
    imports: Array.isArray(payload.imports) ? payload.imports.map(normalizeTaskHistoryRecord) : [],
    storeMetricRuns: Array.isArray(payload.storeMetricRuns) ? payload.storeMetricRuns : []
  };
}

function writeTaskHistory(history) {
  // 这个函数只原子写入统一历史文件，并限制每类最多保留 200 条。
  writeJsonFileAtomic(resolveTaskHistoryPath(), {
    downloads: Array.isArray(history.downloads) ? history.downloads.slice(0, TASK_HISTORY_RECORD_LIMIT) : [],
    imports: Array.isArray(history.imports) ? history.imports.slice(0, TASK_HISTORY_RECORD_LIMIT) : [],
    storeMetricRuns: Array.isArray(history.storeMetricRuns)
      ? history.storeMetricRuns.slice(0, TASK_HISTORY_RECORD_LIMIT)
      : []
  });
}

module.exports = {
  TASK_HISTORY_RECORD_LIMIT,
  readTaskHistory,
  writeTaskHistory
};
