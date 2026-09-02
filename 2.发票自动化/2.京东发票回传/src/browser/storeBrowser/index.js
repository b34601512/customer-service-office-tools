const { 构建浏览器启动参数, 规范化浏览器启动地址 } = require('./launchArgs');
const { 解析店铺浏览器参数 } = require('./storeBrowserPaths');
const { 保存店铺浏览器登录态 } = require('./authStateStore');
const { 创建店铺浏览器上下文 } = require('./contextFactory');

module.exports = {
  构建浏览器启动参数,
  规范化浏览器启动地址,
  解析店铺浏览器参数,
  保存店铺浏览器登录态,
  创建店铺浏览器上下文,
};
