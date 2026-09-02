const 拼多多默认后台地址 = 'https://mms.pinduoduo.com/login/?redirectUrl=https%3A%2F%2Fmms.pinduoduo.com%2F';

function 读取拼多多业务后台地址(店铺配置 = {}) {
  // 解决：店铺可自定义入口，默认走拼多多商家后台登录入口。
  return String(店铺配置.targetUrl || 拼多多默认后台地址).trim() || 拼多多默认后台地址;
}

module.exports = {
  拼多多默认后台地址,
  读取拼多多业务后台地址,
};
