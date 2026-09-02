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

function 解析发布信息(packageJson, 打包配置) {
  // 解决：把内部版本和对外显示版本分离，避免 npm 语义化版本和客服分发版本互相牵制。
  const 显示版本 = String(
    打包配置?.displayVersion
    || packageJson.displayVersion
    || packageJson.version
    || '0.0.1',
  ).trim();
  if (!显示版本) {
    throw new Error('打包配置缺少 displayVersion，请先填写对外版本号。');
  }

  if (/[<>:"/\\|?*\u0000-\u001f]/.test(显示版本)) {
    throw new Error(`打包配置里的版本号不合法：${显示版本}`);
  }

  return {
    内部版本: String(packageJson.version || '0.0.1'),
    显示版本,
  };
}

function 读取打包配置(projectRoot = 项目根目录, options = {}) {
  // 解决：统一读取打包配置，运行时和打包脚本都走同一套规则。
  const { 允许缺失 = false } = options;
  const 打包配置路径 = path.join(projectRoot, '打包配置.json');

  if (!fs.existsSync(打包配置路径)) {
    if (允许缺失) {
      return {};
    }
    throw new Error('缺少打包配置文件：打包配置.json');
  }

  return 读取JSON文件(打包配置路径, '缺少打包配置文件：打包配置.json');
}

function 读取发布信息(projectRoot = 项目根目录, options = {}) {
  // 解决：统一把 package.json 和打包配置解析成可复用的发布信息对象。
  const { 严格校验打包配置 = false } = options;
  const packageJson路径 = path.join(projectRoot, 'package.json');
  const packageJson = 读取JSON文件(packageJson路径, '缺少 package.json 文件，无法读取版本信息。');
  const 打包配置 = 读取打包配置(projectRoot, {
    允许缺失: !严格校验打包配置,
  });
  return 解析发布信息(packageJson, 打包配置);
}

module.exports = {
  解析发布信息,
  读取打包配置,
  读取发布信息,
};
