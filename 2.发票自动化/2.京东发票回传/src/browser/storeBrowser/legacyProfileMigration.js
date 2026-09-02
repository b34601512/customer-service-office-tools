const fs = require('fs');
const { chromium } = require('playwright');
const { 打印日志 } = require('../../common/logger');
const { 迁移到备份目录 } = require('../../common/runtimeCleaner');
const { 构建浏览器启动参数 } = require('./launchArgs');
const { 保存店铺浏览器登录态 } = require('./authStateStore');

async function 旧浏览器档案存在(旧浏览器目录) {
  // 解决：只有旧 profile 真实存在时才执行一次性登录态迁移。
  return Boolean(旧浏览器目录) && fs.existsSync(旧浏览器目录);
}

async function 从旧浏览器档案导出登录态({ 店铺标识, 旧浏览器目录, 登录态文件路径, 启动地址 = '' }) {
  // 解决：从旧完整浏览器档案提取最小登录态，避免用户已登录状态直接丢失。
  打印日志('登录态迁移', '店铺浏览器', `开始迁移旧浏览器档案：${店铺标识}`);
  const context = await chromium.launchPersistentContext(旧浏览器目录, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
    args: 构建浏览器启动参数(启动地址),
  });
  try {
    await 保存店铺浏览器登录态(context, 登录态文件路径);
  } finally {
    await context.close();
  }
}

function 归档旧浏览器档案(旧浏览器目录, 选项 = {}) {
  // 解决：登录态迁移完成后把旧完整 profile 移出项目，避免新旧设计混用。
  const 备份路径 = 迁移到备份目录(旧浏览器目录, 选项);
  if (备份路径) {
    打印日志('登录态迁移', '店铺浏览器', `旧浏览器档案已迁移到备份：${备份路径}`);
  }
  return 备份路径;
}

async function 迁移旧浏览器档案登录态(选项 = {}) {
  // 解决：首次运行新结构时自动把旧 profile 转成最小登录态，然后移走旧 profile。
  const {
    店铺标识,
    旧浏览器目录,
    登录态文件路径,
    启动地址 = '',
    now = new Date(),
    projectRoot,
    备份根目录,
  } = 选项;
  const 归档选项 = { now, projectRoot, 备份根目录 };
  if (fs.existsSync(登录态文件路径)) {
    const backupPath = await 旧浏览器档案存在(旧浏览器目录)
      ? 归档旧浏览器档案(旧浏览器目录, 归档选项)
      : '';
    return { migrated: false, backupPath };
  }
  if (!await 旧浏览器档案存在(旧浏览器目录)) {
    return { migrated: false, backupPath: '' };
  }
  await 从旧浏览器档案导出登录态({
    店铺标识,
    旧浏览器目录,
    登录态文件路径,
    启动地址,
  });
  const backupPath = 归档旧浏览器档案(旧浏览器目录, 归档选项);
  return { migrated: true, backupPath };
}

module.exports = {
  旧浏览器档案存在,
  从旧浏览器档案导出登录态,
  归档旧浏览器档案,
  迁移旧浏览器档案登录态,
};
