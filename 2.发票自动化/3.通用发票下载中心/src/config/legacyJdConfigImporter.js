const fs = require('fs');
const path = require('path');
const { 保存发票系统配置, 构建安全发票系统配置视图 } = require('./invoiceSystemConfig');
const { 配置文件路径, 登录态文件路径 } = require('../common/paths');
const { 确保目录存在, 读取JSON文件 } = require('../common/fs');

const 默认旧京东项目目录 = path.resolve(__dirname, '..', '..', '..', '2.京东发票回传');

function 构建旧项目路径(legacyProjectDirectory = 默认旧京东项目目录) {
  // 这个函数解决从京东项目迁移配置时路径集中计算，避免调用方散落硬编码。
  const 项目目录 = path.resolve(legacyProjectDirectory);
  return {
    storesConfigPath: path.join(项目目录, 'data', 'stores.json'),
    authStatePath: path.join(项目目录, 'data', 'invoice-system-auth-state.json'),
  };
}

function 导入旧京东发票系统配置(options = {}) {
  // 这个函数解决旧京东项目已配置诺诺账号时，新下载中心无需重复录入。
  const 路径 = 构建旧项目路径(options.legacyProjectDirectory);
  const 旧配置 = 读取JSON文件(路径.storesConfigPath, {});
  const 发票系统配置 = 旧配置.invoiceSystem || {};
  if (!String(发票系统配置.username || '').trim() || !String(发票系统配置.password || '')) {
    throw new Error('导入旧京东配置失败：旧项目没有可用的诺诺账号或密码。');
  }
  const 新配置 = 保存发票系统配置({
    provider: 'nuonuo',
    targetUrl: 发票系统配置.targetUrl,
    username: 发票系统配置.username,
    password: 发票系统配置.password,
  }, options.configFilePath || 配置文件路径);

  let copiedAuthState = false;
  const 目标登录态路径 = options.authStateFilePath || 登录态文件路径;
  if (fs.existsSync(路径.authStatePath)) {
    确保目录存在(path.dirname(目标登录态路径));
    fs.copyFileSync(路径.authStatePath, 目标登录态路径);
    copiedAuthState = true;
  }

  return {
    config: 构建安全发票系统配置视图(新配置),
    copiedAuthState,
  };
}

module.exports = {
  默认旧京东项目目录,
  构建旧项目路径,
  导入旧京东发票系统配置,
};
