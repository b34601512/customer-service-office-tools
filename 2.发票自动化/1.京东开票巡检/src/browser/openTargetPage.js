const { 打印日志 } = require('../common/logger');

const 目标页面地址 = 'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html';

async function 获取可用页面(context) {
  // 解决：优先复用持久化上下文自带页面，没有页面时再创建新页。
  return context.pages()[0] ?? await context.newPage();
}

async function 打开目标页面(context, 目标地址 = 目标页面地址) {
  // 解决：开页阶段只负责导航，业务加载状态交给后续业务等待，避免重复等待误报失败。
  const page = await 获取可用页面(context);
  打印日志('页面导航', '目标页面', `打开页面：${目标地址}`);
  await page.goto(目标地址, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  return page;
}

module.exports = {
  目标页面地址,
  打开目标页面,
};
