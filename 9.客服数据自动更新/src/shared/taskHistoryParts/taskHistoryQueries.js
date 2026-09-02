const { readTaskHistory } = require("./taskHistoryStore");
const {
  doesTaskHistoryRecordMatchScope,
  selectLatestTaskHistoryRecord
} = require("./taskHistoryScopeMatcher");

function readLatestDownloadRecord(platformKey, storeKey, exportRange = null, options = {}) {
  // 这个函数只读取当前成功作用域内最新的有效下载记录。
  return selectLatestTaskHistoryRecord(
    readTaskHistory().downloads,
    (record) => doesTaskHistoryRecordMatchScope(record, platformKey, storeKey, exportRange, options) && record.filePath
  );
}

module.exports = {
  readLatestDownloadRecord
};
