const { 初始化运行目录 } = require('../common/fs');
const { 打印日志 } = require('../common/logger');
const { 获取启用店铺列表, 获取指定或首个启用店铺 } = require('../store/storeConfigService');
const { 创建拼多多店铺浏览器上下文, 获取或打开拼多多页面 } = require('../browser/pddBrowserContext');
const { 等待拼多多登录完成 } = require('../browser/pddAuthenticatedPage');
const { 读取拼多多业务后台地址 } = require('../browser/pddBusinessUrl');

async function 登录单个拼多多店铺(店铺配置, 选项 = {}) {
  // 解决：单店登录只负责打开、填充、等待登录成功，并把资料目录留给浏览器持久化。
  const {
    headless = false,
    登录等待超时毫秒 = 15 * 60_000,
  } = 选项;
  初始化运行目录();
  const context = await 创建拼多多店铺浏览器上下文(店铺配置, { headless });
  try {
    const page = await 获取或打开拼多多页面(context, 读取拼多多业务后台地址(店铺配置));
    打印日志('拼多多登录', '主流程', `开始登录店铺：${店铺配置.name}`);
    await 等待拼多多登录完成(page, 店铺配置, { timeoutMs: 登录等待超时毫秒 });
    打印日志('拼多多登录', '主流程', `登录完成：${店铺配置.name}`);
    return {
      storeId: 店铺配置.id,
      storeName: 店铺配置.name,
      profilePath: context.__pddStoreProfilePath,
    };
  } finally {
    // 浏览器保持打开，供人工核实；用户看完手动关闭窗口即可。
  }
}

async function 登录首个或指定拼多多店铺(storeId = '', 选项 = {}) {
  // 解决：命令行默认登录第一家启用店铺，同时允许指定店铺 id。
  const 店铺配置 = 获取指定或首个启用店铺(storeId);
  return 登录单个拼多多店铺(店铺配置, 选项);
}

async function 登录全部启用拼多多店铺(选项 = {}) {
  // 解决：多店铺登录串行执行，避免多个验证窗口同时弹出导致人工混乱。
  const 店铺列表 = 获取启用店铺列表();
  if (!店铺列表.length) {
    throw new Error('没有启用中的拼多多店铺，请先编辑 data/stores.json。');
  }
  const 登录结果列表 = [];
  for (const [索引, 店铺配置] of 店铺列表.entries()) {
    打印日志('拼多多登录', '批量登录', `第 ${索引 + 1}/${店铺列表.length} 个店铺：${店铺配置.name}`);
    登录结果列表.push(await 登录单个拼多多店铺(店铺配置, 选项));
  }
  return 登录结果列表;
}

module.exports = {
  登录单个拼多多店铺,
  登录首个或指定拼多多店铺,
  登录全部启用拼多多店铺,
};
