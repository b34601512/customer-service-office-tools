const { 获取当前硬盘备份目录 } = require('./paths');
const { 计算路径大小字节 } = require('./runtimeCleanup/pathSize');
const { 构建备份目标路径 } = require('./runtimeCleanup/backupPath');
const { 迁移到备份目录 } = require('./runtimeCleanup/pathMigration');
const { 清理运行垃圾路径列表 } = require('./runtimeCleanup/cleanupRunner');
const { 构建启动清理路径列表, 执行启动自动清理 } = require('./runtimeCleanup/startupAutoCleanup');

module.exports = {
  获取当前硬盘备份目录,
  计算路径大小字节,
  构建备份目标路径,
  迁移到备份目录,
  清理运行垃圾路径列表,
  构建启动清理路径列表,
  执行启动自动清理,
};
