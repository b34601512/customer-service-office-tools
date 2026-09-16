const fs = require('fs');
const path = require('path');
const { 项目根目录 } = require('./paths');

function 读取JSON文件(文件路径, 缺失错误消息) {
  // 解决：集中读取 UTF-8 JSON，避免多个入口各自处理缺文件和解析错误。
  if (!fs.existsSync(文件路径)) {
    throw new Error(缺失错误消息);
  }

  return JSON.parse(fs.readFileSync(文件路径, 'utf8'));
}

function 解析发布信息(packageJson) {
  // 解决：对外显示版本统一从 package.json 的 displayVersion 读取（不再有独立打包配置）。
  const 显示版本 = String(
    packageJson.displayVersion
    || packageJson.version
    || '0.0.1',
  ).trim();
  if (!显示版本) {
    throw new Error('package.json 缺少 displayVersion，请先填写对外版本号。');
  }

  if (/[<>:"/\\|?*\u0000-\u001f]/.test(显示版本)) {
    throw new Error(`package.json 里的版本号不合法：${显示版本}`);
  }

  return {
    内部版本: String(packageJson.version || '0.0.1'),
    显示版本,
  };
}

function 读取发布信息(projectRoot = 项目根目录) {
  // 解决：统一把 package.json 解析成可复用的发布信息对象。
  const packageJson路径 = path.join(projectRoot, 'package.json');
  const packageJson = 读取JSON文件(packageJson路径, '缺少 package.json 文件，无法读取版本信息。');
  return 解析发布信息(packageJson);
}

module.exports = {
  解析发布信息,
  读取发布信息,
};
