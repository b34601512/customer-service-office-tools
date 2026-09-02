const { 获取当前硬盘备份目录 } = require('./paths');
const { 店铺垃圾相对路径列表 } = require('./runtimeCleanup/cachePathPlan');
const { 计算路径大小字节 } = require('./runtimeCleanup/pathSize');
const { 构建备份目标路径 } = require('./runtimeCleanup/backupPath');
const { 迁移到备份目录 } = require('./runtimeCleanup/pathMigration');
const { 清理店铺浏览器缓存 } = require('./runtimeCleanup/storeProfileCleanup');

const 默认单项清理阈值字节 = 0;

module.exports = {
  默认单项清理阈值字节,
  店铺缓存相对路径列表: 店铺垃圾相对路径列表,
  获取当前硬盘备份目录,
  计算路径大小字节,
  构建备份目标路径,
  迁移到备份目录,
  清理店铺浏览器缓存,
};
