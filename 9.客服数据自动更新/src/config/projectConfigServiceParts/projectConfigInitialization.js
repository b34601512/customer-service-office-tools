const appConfig = require("../appConfig");
const { log } = require("../../engine/logger");
const { readJsonFile, writeJsonFileAtomic } = require("../../shared/fileStore");
const { refreshDefaultCompletedExportDateRange } = require("./projectConfigGlobalDateSync");
const { ensureProjectConfigFile, backupProjectConfigFileIfNeeded } = require("./projectConfigFileLifecycle");
const { refreshProjectConfigCache } = require("./projectConfigCache");
const {
  shouldPersistManualDateMigration,
  shouldPersistDateAutomationMigration,
  shouldPersistReportProfileNormalization,
  shouldPersistStoreIsolationNormalization,
  shouldPersistKdocsSyncMigration
} = require("./projectConfigMigrationDetection");
const { normalizeProjectConfigPayload } = require("./projectConfigNormalization");
const { clone, normalizeString } = require("./projectConfigValuePrimitives");

function buildProjectConfigInitializationPlan(fileConfig, normalizedConfig, needsDefaultCompletedDateRefresh) {
  // 这个函数只判断启动时需要落盘的迁移和日期刷新，不执行写盘。
  const plan = {
    needsManualDateMigration: shouldPersistManualDateMigration(fileConfig),
    needsDateAutomationMigration: shouldPersistDateAutomationMigration(fileConfig),
    needsReportProfileNormalization: shouldPersistReportProfileNormalization(fileConfig),
    needsStoreIsolationNormalization: shouldPersistStoreIsolationNormalization(fileConfig),
    needsKdocsSyncMigration: shouldPersistKdocsSyncMigration(fileConfig),
    needsGlobalDownloadRootNormalization:
      normalizeString(fileConfig?.globalDefaults?.downloadRootDir) !==
      normalizeString(normalizedConfig.globalDefaults.downloadRootDir),
    needsDefaultCompletedDateRefresh: Boolean(needsDefaultCompletedDateRefresh)
  };
  plan.hasMigration =
    plan.needsManualDateMigration ||
    plan.needsDateAutomationMigration ||
    plan.needsReportProfileNormalization ||
    plan.needsStoreIsolationNormalization ||
    plan.needsKdocsSyncMigration ||
    plan.needsGlobalDownloadRootNormalization;
  plan.shouldPersist = plan.hasMigration || plan.needsDefaultCompletedDateRefresh;
  return plan;
}

function logProjectConfigInitialization(plan, normalizedConfig, backupPath) {
  // 这个函数只记录本次启动实际执行的配置迁移和日期刷新结果。
  const migrationLogs = [
    [plan.needsReportProfileNormalization, "结构规范化", `已把缺失的 reportProfiles 结构补齐并写回配置文件；规范化前备份=${backupPath || "未生成"}`],
    [plan.needsStoreIsolationNormalization, "店铺隔离规范化", `已把非隔离下载目录改写为店铺独立目录；规范化前备份=${backupPath || "未生成"}`],
    [plan.needsKdocsSyncMigration, "金山三脚本配置", `已把旧配置迁移为同步、筛选和客服姓名确认三 webhook 结构；迁移前备份=${backupPath || "未生成"}`],
    [plan.needsGlobalDownloadRootNormalization, "下载根目录规范化", `已写入总下载根目录=${normalizedConfig.globalDefaults.downloadRootDir}；规范化前备份=${backupPath || "未生成"}`],
    [plan.needsManualDateMigration, "日期手动化", `已把历史自动日期规则收口成固定日期并写回配置文件；迁移前备份=${backupPath || "未生成"}`],
    [plan.needsDateAutomationMigration, "日期自动化配置", `已补齐全店跨度、延迟天数和单店跟随状态；规范化前备份=${backupPath || "未生成"}`]
  ];
  migrationLogs.filter(([shouldLog]) => shouldLog).forEach(([, action, detail]) => {
    log("主线:完成", "项目配置", action, detail);
  });
  if (plan.needsDefaultCompletedDateRefresh) {
    log(
      "主线:完成",
      "项目配置",
      "启动日期刷新",
      `已按启动日期更新为${normalizedConfig.globalDefaults.exportDateRange.start.customDate}至${normalizedConfig.globalDefaults.exportDateRange.end.customDate}，并同步仍跟随全局的店铺。`
    );
  }
}

function persistProjectConfigInitialization(normalizedConfig, plan) {
  // 这个函数只在明确启动动作中备份迁移并写入配置。
  if (!plan.shouldPersist) {
    return;
  }
  const backupPath = plan.hasMigration ? backupProjectConfigFileIfNeeded() : "";
  writeJsonFileAtomic(appConfig.projectConfigPath, normalizedConfig);
  logProjectConfigInitialization(plan, normalizedConfig, backupPath);
}

function initializeProjectConfigForStartup(baseDate = new Date()) {
  // 这个函数是首次建档、结构迁移和启动日期刷新的唯一写盘入口。
  ensureProjectConfigFile();
  const fileConfig = readJsonFile(appConfig.projectConfigPath, "项目配置");
  const normalizedConfig = normalizeProjectConfigPayload(fileConfig);
  const needsDateRefresh = refreshDefaultCompletedExportDateRange(normalizedConfig, baseDate);
  const plan = buildProjectConfigInitializationPlan(fileConfig, normalizedConfig, needsDateRefresh);
  persistProjectConfigInitialization(normalizedConfig, plan);
  refreshProjectConfigCache(normalizedConfig);
  return clone(normalizedConfig);
}

module.exports = {
  initializeProjectConfigForStartup
};
