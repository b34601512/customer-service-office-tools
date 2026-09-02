const { normalizeTaskHistoryRecord } = require("./taskHistoryRecordNormalizer");
const {
  TASK_HISTORY_RECORD_LIMIT,
  readTaskHistory,
  writeTaskHistory
} = require("./taskHistoryStore");

function appendTaskHistoryRecord(sectionName, record) {
  // 这个函数只把一条标准记录追加到指定历史分区的最前面。
  const history = readTaskHistory();
  const nextRecord = normalizeTaskHistoryRecord(record);
  history[sectionName] = [nextRecord, ...(history[sectionName] || [])].slice(0, TASK_HISTORY_RECORD_LIMIT);
  writeTaskHistory(history);
  return nextRecord;
}

function appendDownloadRecord(record) {
  // 这个函数只登记一次已成功完成的下载。
  return appendTaskHistoryRecord("downloads", record);
}

function appendImportRecord(record) {
  // 这个函数只登记一次已成功完成的导入。
  return appendTaskHistoryRecord("imports", record);
}

module.exports = {
  appendDownloadRecord,
  appendImportRecord
};
