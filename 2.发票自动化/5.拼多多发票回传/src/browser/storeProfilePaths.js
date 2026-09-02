const crypto = require('crypto');
const path = require('path');
const { 店铺浏览器资料目录, 规范化店铺标识 } = require('../common/paths');

function 计算账号资料目录标识(username) {
  // 解决：账号要参与隔离，但不能把明文账号写进路径。
  const 标准账号 = String(username || '').trim();
  if (!标准账号) {
    return 'manual';
  }
  const 摘要 = crypto.createHash('sha256').update(标准账号, 'utf8').digest('hex').slice(0, 12);
  return `account-${摘要}`;
}

function 获取店铺账号浏览器资料目录(选项 = {}) {
  // 解决：按浏览器、店铺、账号三层隔离登录环境，避免多店铺串号。
  const 店铺标识 = 规范化店铺标识(选项.storeId || 选项.店铺标识 || '');
  if (!店铺标识) {
    throw new Error('获取拼多多浏览器资料目录失败：店铺标识不能为空。');
  }
  const 浏览器名称 = String(选项.browserName || 'msedge').trim().toLowerCase() || 'msedge';
  const 账号目录 = 计算账号资料目录标识(选项.username);
  return path.join(店铺浏览器资料目录, 浏览器名称, 店铺标识, 账号目录);
}

module.exports = {
  计算账号资料目录标识,
  获取店铺账号浏览器资料目录,
};
