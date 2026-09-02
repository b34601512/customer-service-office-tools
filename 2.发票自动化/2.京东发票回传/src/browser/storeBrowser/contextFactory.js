const { chromium } = require('playwright');
const { 打印日志 } = require('../../common/logger');
const { 构建浏览器启动参数 } = require('./launchArgs');
const { 解析店铺浏览器参数, 店铺登录态文件存在 } = require('./storeBrowserPaths');
const { 绑定浏览器生命周期 } = require('./contextLifecycle');
const { 迁移旧浏览器档案登录态 } = require('./legacyProfileMigration');

function 构建新上下文选项(登录态文件路径) {
  // 解决：只把最小登录态喂给临时上下文，避免长期保存完整浏览器 profile。
  const 选项 = {
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
  };
  if (店铺登录态文件存在(登录态文件路径)) {
    选项.storageState = 登录态文件路径;
  }
  return 选项;
}

async function 启动临时浏览器(headless, 启动地址) {
  // 解决：每次识别使用临时 browser，关闭后不在项目内留下完整用户目录。
  return chromium.launch({
    channel: 'msedge',
    headless,
    args: 构建浏览器启动参数(启动地址),
  });
}

async function 创建店铺浏览器上下文(选项 = {}) {
  // 解决：用最小登录态创建临时浏览器上下文，替代长期持久化 browser profile。
  const {
    headless = true,
    启动地址 = '',
  } = 选项;
  const 参数 = 解析店铺浏览器参数(选项);
  await 迁移旧浏览器档案登录态({
    店铺标识: 参数.店铺标识,
    旧浏览器目录: 参数.旧浏览器目录,
    登录态文件路径: 参数.登录态文件路径,
    启动地址,
  });

  打印日志('浏览器启动', '浏览器上下文', `店铺=${参数.店铺标识} headless=${headless} 登录态=${参数.登录态文件路径}`);
  const browser = await 启动临时浏览器(headless, 启动地址);
  const context = await browser.newContext(构建新上下文选项(参数.登录态文件路径));
  context.__storeAuthStatePath = 参数.登录态文件路径;
  context.__storeId = 参数.店铺标识;
  return 绑定浏览器生命周期(context, browser);
}

module.exports = {
  构建新上下文选项,
  启动临时浏览器,
  创建店铺浏览器上下文,
};
