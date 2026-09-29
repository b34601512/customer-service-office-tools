const { 等待直到 } = require('./dynamicWait');
const { 准备抖音手机号登录 } = require('./douyinLoginDom');
const { 打印日志 } = require('../common/logger');

// 2026-09-29 假过期修复：与 9号 douyinLoginRecovery 同族问题——登录态其实有效，
// 但浏览器重开时偶发先渲染登录页壳，页面会在 1~3 分钟内自行回到 /ffa/ 业务页；
// 登录页先观察这个宽限期，期间不做任何人工介入（不预填、不点发送验证码）。
const 默认登录页宽限毫秒 = 15_000;

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

async function 是抖音页面接近空白(page) {
  // 2026-09-29：与 9号 douyinLoginRecovery 同款判定（09-27 白屏实况：根节点 1920x0、innerText 空）。
  // 登录页壳偶发渲染失败时，登录态其实有效，F5 一次即可回到商家首页。
  try {
    const 快照 = await page.evaluate(() => {
      const body = document.body;
      const text = body ? String(body.innerText || '').trim() : '';
      const roots = body ? Array.from(body.children) : [];
      const maxRootHeight = roots.reduce((max, element) => {
        const rect = element.getBoundingClientRect();
        return Math.max(max, rect.height || 0);
      }, 0);
      const visibleControls = Array.from(document.querySelectorAll('input, button, a'))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length;
      return { textLength: text.length, maxRootHeight, visibleControls };
    });
    return Boolean(快照)
      && 快照.textLength === 0
      && 快照.maxRootHeight < 10
      && 快照.visibleControls === 0;
  } catch (_错误) {
    return false;
  }
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
  // 2026-09-29 假过期修复：登录页可能只是渲染时序（页面会在 1~3 分钟内自行回到 /ffa/），
  // 所以①接近空白的页签只重载一次；②登录页先等一个宽限期，期间不做任何人工介入；
  // ③宽限后仍停在登录页才预填手机号，且不自动点「发送验证码」。
  const {
    timeoutMs = 15 * 60_000,
    intervalMs = 1000,
    登录页宽限毫秒 = 默认登录页宽限毫秒,
    依赖 = {},
  } = 选项;
  const 执行手机号预填 = 依赖.准备抖音手机号登录 || 准备抖音手机号登录;
  let 已尝试填充 = false;
  let 已尝试打开官网登录页 = false;
  let 上次提示 = '';
  let 上次周期日志时间 = 0;
  let 登录页首次出现时间 = 0;
  let 当前页面 = page;
  const 已重载空白页 = new Set();

  return 等待直到(page, async () => {
    const 当前地址 = 当前页面.url();
    if (是抖音业务页面(当前地址) && await 页面包含抖音后台特征(当前页面)) {
      打印日志('抖音登录', '登录状态', `业务页面已就绪：${店铺配置.name}`);
      return true;
    }

    if (!已重载空白页.has(当前页面) && await 是抖音页面接近空白(当前页面)) {
      已重载空白页.add(当前页面);
      打印日志('抖音登录', '登录状态', `抖音页面暂无内容，先重载一次确认是否真的过期：${店铺配置.name}`);
      await 当前页面.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      return false;
    }

    if (!已尝试打开官网登录页 && 是抖音官网首页(当前地址)) {
      已尝试打开官网登录页 = true;
      打印日志('抖音登录', '登录状态', `正在打开登录抖店页面：${店铺配置.name}`);
      当前页面 = await 打开抖音官网登录页(当前页面);
    }

    if (是抖音登录页面(当前页面.url())) {
      if (!登录页首次出现时间) 登录页首次出现时间 = Date.now();
      if (!已尝试填充 && Date.now() - 登录页首次出现时间 >= Math.max(0, Number(登录页宽限毫秒) || 0)) {
        const 填充结果 = await 执行手机号预填(当前页面, 店铺配置, { autoSendCode: false });
        已尝试填充 = 已尝试填充 || 填充结果.filled;
        if (填充结果.message && 填充结果.message !== 上次提示) {
          上次提示 = 填充结果.message;
          打印日志('抖音登录', '登录状态', 填充结果.message);
        }
      }
    } else {
      登录页首次出现时间 = 0;
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
  是抖音页面接近空白,
  默认登录页宽限毫秒,
  打开抖音官网登录页,
  等待抖音登录完成,
};
