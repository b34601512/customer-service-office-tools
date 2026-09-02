// 该文件用于解决运行历史路径从旧 runtime 结构迁移到新结构的问题。
const { readJsonFile, writeJsonFileAtomic } = require("../../shared/fileStore");
const { log } = require("../../engine/logger");
const appConfig = require("../appConfig");
const { remapRuntimeMigrationPath } = require("../runtimePathParts/runtimeMigrationPaths");
const { pathExists } = require("./runtimePathHelpers");

function normalizeHistoryPayload(historyPayload, projectRoot = appConfig.projectRoot) {
  // 这个函数只把历史记录里的旧 runtime 路径改写成新分层路径。
  const normalizeSection = (items) =>
    Array.isArray(items)
      ? items.map((item) => ({
        ...item,
        filePath: remapRuntimeMigrationPath(projectRoot, item?.filePath),
        sourceFilePath: remapRuntimeMigrationPath(projectRoot, item?.sourceFilePath),
        workbookPath: remapRuntimeMigrationPath(projectRoot, item?.workbookPath)
      }))
      : [];

  return {
    downloads: normalizeSection(historyPayload?.downloads),
    imports: normalizeSection(historyPayload?.imports),
    storeMetricRuns: normalizeSection(historyPayload?.storeMetricRuns)
  };
}

function migrateTaskHistory(sourceLayout, runtimeConfig, movePathFn, dependencies = {}) {
  // 这个函数只负责运行历史文件迁移和历史内容路径修正。
  const logFn = dependencies.logFn || log;
  movePathFn(sourceLayout.taskHistoryPath, runtimeConfig.taskHistoryPath, {
    moduleName: "运行目录",
    subAction: "迁移运行历史",
    pendingDetail: "运行历史文件当前被占用"
  });

  if (!pathExists(runtimeConfig.taskHistoryPath)) {
    return false;
  }

  const historyPayload = readJsonFile(runtimeConfig.taskHistoryPath, "运行历史");
  const normalizedPayload = normalizeHistoryPayload(historyPayload, runtimeConfig.projectRoot);
  if (JSON.stringify(historyPayload) === JSON.stringify(normalizedPayload)) {
    return false;
  }

  writeJsonFileAtomic(runtimeConfig.taskHistoryPath, normalizedPayload);
  logFn("主线:完成", "运行目录", "修正历史路径", `运行历史已改写为新结构：${runtimeConfig.taskHistoryPath}`);
  return true;
}

module.exports = {
  migrateTaskHistory
};
