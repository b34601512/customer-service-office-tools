const fs = require('fs');
const path = require('path');

const 作者名称 = '黎路遥';
const 作者微信 = 'luyao2089';
const 官方网站域名 = 'luyao2089.cc';
const 总入口版本 = '0.01';

function 读取JSON文件(文件路径) {
  return JSON.parse(fs.readFileSync(文件路径, 'utf8'));
}

function 读取项目显示版本(项目根目录) {
  const packageJson路径 = path.join(项目根目录, 'package.json');
  const packageJson = 读取JSON文件(packageJson路径);
  const 打包配置路径 = path.join(项目根目录, '打包配置.json');
  const 打包配置 = fs.existsSync(打包配置路径) ? 读取JSON文件(打包配置路径) : {};
  return String(
    打包配置.displayVersion
    || packageJson.displayVersion
    || packageJson.version
    || '0.0.1',
  ).trim();
}

function 构建应用展示信息({ 应用名称, 显示版本 }) {
  return {
    appName: String(应用名称 || ''),
    version: String(显示版本 || ''),
    authorName: 作者名称,
    authorWechat: 作者微信,
    officialWebsite: 官方网站域名,
    officialWebsiteUrl: `https://${官方网站域名}`,
  };
}

function 读取应用展示信息({ 项目根目录, 应用名称 }) {
  return 构建应用展示信息({
    应用名称,
    显示版本: 读取项目显示版本(项目根目录),
  });
}

function 格式化应用展示信息(应用展示信息) {
  if (!应用展示信息) return '';
  const 版本号 = String(应用展示信息.version || '未知').trim();
  return [
    `作者：${应用展示信息.authorName || 作者名称}`,
    `微信：${应用展示信息.authorWechat || 作者微信}`,
    `官网：${应用展示信息.officialWebsite || 官方网站域名}`,
    `版本：v${版本号}`,
  ].join('｜');
}

module.exports = {
  作者名称,
  作者微信,
  官方网站域名,
  总入口版本,
  读取项目显示版本,
  构建应用展示信息,
  读取应用展示信息,
  格式化应用展示信息,
};
