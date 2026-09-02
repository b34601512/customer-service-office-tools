const { 配置文件路径 } = require('../common/paths');
const { 读取JSON文件, 写入JSON文件 } = require('../common/fs');

const 默认发票系统地址 = 'https://work.nuonuo.com/index';
const 默认发票查询最近天数 = 30;

function 规范化发票查询最近天数(value) {
  // 这个函数解决发票查询兜底时间范围可配置，同时避免异常大范围拖慢系统。
  const numberValue = Number.parseInt(value, 10);
  if (!Number.isFinite(numberValue)) return 默认发票查询最近天数;
  if (numberValue < 1 || numberValue > 365) {
    throw new Error('发票查询最近天数必须在 1 到 365 之间。');
  }
  return numberValue;
}

function 规范化发票系统配置(raw = {}) {
  // 这个函数解决外部传入配置格式不稳定的问题。
  return {
    provider: String(raw.provider || 'nuonuo').trim() || 'nuonuo',
    targetUrl: String(raw.targetUrl || 默认发票系统地址).trim() || 默认发票系统地址,
    username: String(raw.username || '').trim(),
    password: String(raw.password || ''),
    invoiceSearchRangeDays: 规范化发票查询最近天数(raw.invoiceSearchRangeDays),
    searchAllInvoiceSubjects: raw.searchAllInvoiceSubjects !== false,
  };
}

function 脱敏账号(username) {
  // 这个函数解决接口返回配置状态时不暴露完整账号的问题。
  const value = String(username || '').trim();
  if (!value) return '';
  if (value.length <= 4) return `${value[0]}***`;
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function 构建安全发票系统配置视图(config) {
  // 这个函数解决本地 API 只暴露配置状态，不把密码和完整账号返回给调用方。
  const 标准配置 = 规范化发票系统配置(config);
  return {
    provider: 标准配置.provider,
    targetUrl: 标准配置.targetUrl,
    hasUsername: Boolean(标准配置.username),
    usernameMasked: 脱敏账号(标准配置.username),
    hasPassword: Boolean(标准配置.password),
    invoiceSearchRangeDays: 标准配置.invoiceSearchRangeDays,
    searchAllInvoiceSubjects: 标准配置.searchAllInvoiceSubjects,
  };
}

function 读取发票系统配置(文件路径 = 配置文件路径) {
  // 这个函数解决项目统一读取发票系统账号配置的问题。
  return 规范化发票系统配置(读取JSON文件(文件路径, {}));
}

function 保存发票系统配置(config, 文件路径 = 配置文件路径) {
  // 这个函数解决项目统一保存发票系统账号配置的问题。
  const 标准配置 = 规范化发票系统配置(config);
  写入JSON文件(文件路径, 标准配置);
  return 标准配置;
}

module.exports = {
  默认发票系统地址,
  默认发票查询最近天数,
  规范化发票系统配置,
  规范化发票查询最近天数,
  脱敏账号,
  构建安全发票系统配置视图,
  读取发票系统配置,
  保存发票系统配置,
};
