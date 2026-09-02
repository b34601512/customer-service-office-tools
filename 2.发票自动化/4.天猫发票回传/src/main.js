const { 打印日志 } = require('./common/logger');
const { 读取店铺配置 } = require('./store/storeConfigService');
const { 登录首个或指定天猫店铺, 登录全部启用天猫店铺 } = require('./app/loginStores');
const { 采集首个或指定天猫店铺元素 } = require('./app/collectTmallElements');

function 解析启动模式() {
  // 解决：所有命令行入口集中校验，避免脚本参数各自发散。
  const 模式 = process.argv[2] || 'login';
  if (['login', 'login-all', 'collect', 'check-config'].includes(模式)) {
    return 模式;
  }
  throw new Error('启动参数错误，请使用 login、login-all、collect 或 check-config。');
}

async function main() {
  // 解决：主线程只做调度，具体登录逻辑交给 app 层。
  const 模式 = 解析启动模式();
  打印日志('启动流程', '主程序', `当前模式=${模式}`);
  if (模式 === 'check-config') {
    const 配置 = 读取店铺配置();
    打印日志('配置检查', '店铺配置', `已读取店铺 ${配置.stores.length} 个`);
    return;
  }
  if (模式 === 'login') {
    const storeId = process.argv[3] || '';
    await 登录首个或指定天猫店铺(storeId, { headless: false });
    return;
  }
  if (模式 === 'login-all') {
    await 登录全部启用天猫店铺({ headless: false });
    return;
  }
  if (模式 === 'collect') {
    const storeId = process.argv[3] || '';
    await 采集首个或指定天猫店铺元素(storeId, { headless: false });
  }
}

main().catch((错误) => {
  打印日志('启动失败', '主程序', 错误.message);
  process.exitCode = 1;
});
