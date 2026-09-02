const fs = require('fs');
const path = require('path');
const { 项目根目录 } = require('../paths');
const { 读取店铺垃圾相对路径列表 } = require('./cachePathPlan');
const { 清理运行垃圾路径列表 } = require('./cleanupRunner');

function 构建店铺垃圾绝对路径列表(浏览器目录路径) {
  // 解决：把店铺垃圾清理计划转换成当前店铺 profile 下的真实路径。
  return 读取店铺垃圾相对路径列表().map((相对路径片段) => path.join(浏览器目录路径, ...相对路径片段));
}

function 清理店铺浏览器缓存(选项 = {}) {
  // 解决：店铺运行前后只迁移浏览器垃圾，保留 Cookies、Local Storage、IndexedDB 登录态。
  const {
    店铺标识 = '',
    浏览器目录路径 = '',
    now = new Date(),
    projectRoot = 项目根目录,
    备份根目录,
  } = 选项;
  const 标准浏览器目录 = String(浏览器目录路径 || '').trim();
  if (!标准浏览器目录 || !fs.existsSync(标准浏览器目录)) {
    return [];
  }

  const 路径列表 = 构建店铺垃圾绝对路径列表(标准浏览器目录);
  return 清理运行垃圾路径列表({
    路径列表,
    now,
    projectRoot,
    备份根目录,
    日志模块名: `店铺缓存-${店铺标识 || path.basename(标准浏览器目录)}`,
    清理类型: 'store-browser-cache',
  });
}

module.exports = {
  构建店铺垃圾绝对路径列表,
  清理店铺浏览器缓存,
};
