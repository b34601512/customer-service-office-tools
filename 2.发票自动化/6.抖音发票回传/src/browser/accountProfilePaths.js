const crypto = require('crypto');
const path = require('path');
const { 账号浏览器资料目录 } = require('../common/paths');
const { 读取手机号字段 } = require('../store/storeConfigService');

function 计算账号资料目录标识(phoneNumber) {
  const 手机号 = String(phoneNumber || '').trim();
  if (!手机号) throw new Error('获取抖音账号浏览器失败：请先配置登录手机号。');
  return `account-${crypto.createHash('sha256').update(手机号, 'utf8').digest('hex').slice(0, 12)}`;
}

function 获取账号浏览器资料目录(店铺配置 = {}) {
  // 登录环境属于手机号；店铺身份由业务页面核验，不参与登录资料隔离。
  return path.join(账号浏览器资料目录, 'msedge', 计算账号资料目录标识(读取手机号字段(店铺配置)));
}

module.exports = { 计算账号资料目录标识, 获取账号浏览器资料目录 };
