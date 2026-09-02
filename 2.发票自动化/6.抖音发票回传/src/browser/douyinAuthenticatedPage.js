const { 等待直到 } = require('./dynamicWait');
const { 准备抖音手机号登录 } = require('./douyinLoginDom');
const { 打印日志 } = require('../common/logger');

function 解析抖音地址(url) {
  // 解决：第三方跳转地址可能为空，统一解析失败返回空。
  try {
    return new URL(String(url || ''));
  } catch {
    return null;
  }
}

function 是抖音业务页面(url) {
  // 解决：登录成功后的抖店后台真实业务路径是 /ffa，不依赖页面标题。
  const 地址 = 解析抖音地址(url);
  if (!地址 || 地址.hostname !== 'fxg.jinritemai.com') return false;
  return 地址.pathname.startsWith('/ffa/');
}

function 是抖音登录页面(url) {
  // 解决：登录态检测先识别登录路径，避免把登录页误当业务页。
  const 地址 = 解析抖音地址(url);
  return 地址?.hostname === 'fxg.jinritemai.com' && 地址.pathname.startsWith('/login');
}

function 是抖音官网首页(url) {
  // 解决：抖音默认入口先到官网首页，那里需要先点登录抖店才出现手机号表单。
  const 地址 = 解析抖音地址(url);
  return 地址?.hostname === 'fxg.jinritemai.com' && (地址.pathname === '/' || 地址.pathname === '');
}

async function 页面包含抖音后台特征(page) {
  // 解决：抖音业务页文案会变化，使用多个后台特征交叉判断。
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const 正文 = String(text || '');
  if (正文.includes('扫码登录') || 正文.includes('登录抖店')) return false;
  return ['AI助手', '返回首页', '发票管理', '订单管理', '店铺'].some((keyword) => 正文.includes(keyword));
}

async function 打开抖音官网登录页(page) {
  // 解决：官网首页的登录抖店会打开新页，必须返回真正的登录页继续填手机号。
  const 登录入口 = page.locator('a, button, [role="button"]').filter({ hasText: /^登录抖店$/ }).first();
  if (!await 登录入口.count().catch(() => 0)) {
    return page;
  }
  const context = page.context();
  const newPagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await 登录入口.click({ timeout: 5000 }).catch(async () => {
    await 登录入口.click({ force: true, timeout: 5000 });
  });
  const newPage = await newPagePromise;
  const loginPage = newPage || page;
  await loginPage.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await loginPage.bringToFront().catch(() => {});
  return loginPage;
}

async function 等待抖音登录完成(page, 店铺配置, 选项 = {}) {
  // 解决：用户处理验证码时程序只观察状态，最多自动填一次手机号。
  const {
    timeoutMs = 15 * 60_000,
    intervalMs = 1000,
  } = 选项;
  let 已尝试填充 = false;
  let 已尝试打开官网登录页 = false;
  let 上次提示 = '';
  let 上次周期日志时间 = 0;
  let 当前页面 = page;

  return 等待直到(page, async () => {
    const 当前地址 = 当前页面.url();
    if (是抖音业务页面(当前地址) && await 页面包含抖音后台特征(当前页面)) {
      打印日志('抖音登录', '登录状态', `业务页面已就绪：${店铺配置.name}`);
      return true;
    }

    if (!已尝试打开官网登录页 && 是抖音官网首页(当前地址)) {
      已尝试打开官网登录页 = true;
      打印日志('抖音登录', '登录状态', `正在打开登录抖店页面：${店铺配置.name}`);
      当前页面 = await 打开抖音官网登录页(当前页面);
    }

    if (!已尝试填充 && 是抖音登录页面(当前页面.url())) {
      const 填充结果 = await 准备抖音手机号登录(当前页面, 店铺配置);
      已尝试填充 = 已尝试填充 || 填充结果.filled;
      if (填充结果.message && 填充结果.message !== 上次提示) {
        上次提示 = 填充结果.message;
        打印日志('抖音登录', '登录状态', 填充结果.message);
      }
    }

    const 当前时间 = Date.now();
    if (当前时间 - 上次周期日志时间 >= 5000) {
      上次周期日志时间 = 当前时间;
      打印日志('抖音登录', '登录状态', `等待人工完成验证码或扫码：${店铺配置.name}`);
    }
    return false;
  }, {
    timeoutMs,
    intervalMs,
    超时消息: `等待抖音店铺「${店铺配置.name}」登录完成超时，请重新执行登录。`,
  });
}

module.exports = {
  解析抖音地址,
  是抖音业务页面,
  是抖音登录页面,
  是抖音官网首页,
  页面包含抖音后台特征,
  打开抖音官网登录页,
  等待抖音登录完成,
};
