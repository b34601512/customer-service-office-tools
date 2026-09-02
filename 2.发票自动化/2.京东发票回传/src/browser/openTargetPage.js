const { 打印日志 } = require('../common/logger');
const { 目标页面地址, 是目标地址页面, 是目标地址或登录跳转页面 } = require('./targetPageIdentity');

function 页面已关闭(page) {
  // 解决：兼容测试桩和真实 Playwright 页面，统一判断页面是否还能复用。
  return typeof page?.isClosed === 'function' && page.isClosed();
}

async function 关闭多余页面(页面列表, 保留页面) {
  // 解决：同一上下文可能残留多余页签，打开店铺前收敛成一个业务页签。
  const 多余页面列表 = 页面列表.filter((page) => page && page !== 保留页面 && !页面已关闭(page));
  if (多余页面列表.length === 0) {
    return;
  }

  打印日志('页面导航', '目标页面', `检测到 ${多余页面列表.length} 个历史页签，准备关闭多余页签`);
  for (const page of 多余页面列表) {
    await page.close({ runBeforeUnload: false });
  }
}

async function 获取唯一目标页面(context, 目标地址 = 目标页面地址) {
  // 解决：优先保留已打开的目标页或登录跳转页，避免接管浏览器后重复新开相同流程。
  const 页面列表 = context.pages().filter((page) => page && !页面已关闭(page));
  const page = 页面列表.find((候选页面) => 是目标地址或登录跳转页面(候选页面.url?.(), 目标地址)) ?? 页面列表[0] ?? await context.newPage();
  await 关闭多余页面(context.pages(), page);
  return page;
}

async function 打开目标页面(context, 目标地址 = 目标页面地址) {
  // 解决：至少等首个页面正文加载完成再校验登录态，避免在京东登录重定向前误判为已登录。
  const page = await 获取唯一目标页面(context, 目标地址);
  if (是目标地址页面(page.url?.(), 目标地址)) {
    打印日志('页面导航', '目标页面', `直接使用已打开页面：${目标地址}`);
    return page;
  }

  if (是目标地址或登录跳转页面(page.url?.(), 目标地址)) {
    打印日志('页面导航', '目标页面', `直接使用已打开登录跳转页面：${page.url()}`);
    return page;
  }

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
  获取唯一目标页面,
  是目标地址页面,
};
