// 该文件只负责项目配置文件创建与规范化前备份。
const fs = require("fs");
const path = require("path");
const appConfig = require("../appConfig");
const { writeJsonFileAtomic } = require("../../shared/fileStore");
const { createDefaultProjectConfig } = require("../projectConfigDefaults");

function formatLocalDateTag(date = new Date()) {
  // 该函数只生成配置备份目录使用的本地日期标签。
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildConfigNormalizationBackupPath(date = new Date()) {
  // 该函数只生成配置结构规范化前的备份路径。
  return path.join(
    appConfig.backupRootDir,
    "客服数据自动更新",
    `${formatLocalDateTag(date)}-配置结构规范化`,
    "project-config",
    path.basename(appConfig.projectConfigPath)
  );
}

function backupProjectConfigFileIfNeeded() {
  // 这里先把配置文件备份出来，再执行结构规范化，避免生产配置改写后无法追溯。
  if (!fs.existsSync(appConfig.projectConfigPath)) {
    return "";
  }

  const backupPath = buildConfigNormalizationBackupPath();
  if (fs.existsSync(backupPath)) {
    return backupPath;
  }

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(appConfig.projectConfigPath, backupPath);
  return backupPath;
}

function ensureProjectConfigFile() {
  // 这里在首次运行时自动落一份配置文件，避免前端先读就报不存在。
  if (!fs.existsSync(appConfig.projectConfigPath)) {
    writeJsonFileAtomic(appConfig.projectConfigPath, createDefaultProjectConfig());
  }
}

module.exports = {
  formatLocalDateTag,
  buildConfigNormalizationBackupPath,
  backupProjectConfigFileIfNeeded,
  ensureProjectConfigFile
};
