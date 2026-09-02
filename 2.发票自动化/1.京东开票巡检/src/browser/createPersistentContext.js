const { chromium } = require('playwright');
const { 获取店铺浏览器目录 } = require('../common/paths');
const { 打印日志 } = require('../common/logger');
const { 构建浏览器缓存启动参数 } = require('../runtime/browserProfile');

async function 创建持久化浏览器上下文(选项 = {}) {
  // 解决：复用本地登录态，同时把可再生磁盘缓存导出到独立缓存目录。
  const { headless = true, 店铺标识 = 'default', 浏览器目录路径 = '' } = 选项;
  const 浏览器目录 = 浏览器目录路径 || 获取店铺浏览器目录(店铺标识);
  打印日志('浏览器启动', '浏览器上下文', `店铺=${店铺标识} headless=${headless}`);

  return chromium.launchPersistentContext(浏览器目录, {
    channel: 'msedge',
    headless,
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--window-size=1440,960',
      ...构建浏览器缓存启动参数(浏览器目录),
    ],
  });
}

module.exports = {
  创建持久化浏览器上下文,
};
