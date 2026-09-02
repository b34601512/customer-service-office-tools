const 抖音默认后台地址 = 'https://fxg.jinritemai.com/';

function 读取抖音业务后台地址(店铺配置 = {}) {
  // 解决：店铺可自定义入口，默认走抖音商家后台登录入口。
  return String(店铺配置.targetUrl || 抖音默认后台地址).trim() || 抖音默认后台地址;
}

module.exports = {
  抖音默认后台地址,
  读取抖音业务后台地址,
};
