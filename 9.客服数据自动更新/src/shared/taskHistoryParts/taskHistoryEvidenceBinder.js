const appConfig = require("../../config/appConfig");
const { remapRuntimeMigrationPath } = require("../../config/runtimePathParts/runtimeMigrationPaths");
const { normalizeTaskHistoryRecord } = require("./taskHistoryRecordNormalizer");
const { readTaskHistory, writeTaskHistory } = require("./taskHistoryStore");

function attachDownloadEvidenceFiles(filePath, evidenceFiles) {
  // 这个函数只把下载结束后的凭证绑定回对应源表记录。
  const normalizedFilePath = remapRuntimeMigrationPath(appConfig.projectRoot, String(filePath || "").trim());
  const history = readTaskHistory();
  const record = history.downloads.find((item) => item.filePath === normalizedFilePath);
  if (!record) {
    throw new Error(`保存下载凭证失败：找不到源表历史记录：${normalizedFilePath}`);
  }
  record.evidenceFiles = normalizeTaskHistoryRecord({ evidenceFiles }).evidenceFiles;
  writeTaskHistory(history);
  return record;
}

module.exports = {
  attachDownloadEvidenceFiles
};
