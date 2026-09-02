const { 等待直到 } = require('./dynamicWait');
const { 准备拼多多账号密码登录 } = require('./pddLoginDom');
const { 打印日志 } = require('../common/logger');

function 是拼多多业务页面(url) {
  // 解决：登录完成以商家后台业务域名和非登录路径为准，避免标题变化误判。
  try {
    const 地址 = new URL(String(url || ''));
    return 地址.hostname === 'mms.pinduoduo.com' && !地址.pathname.startsWith('/login');
  } catch {
    return false;
  }
}

function 是拼多多登录页面(url) {
  // 解决：登录态检测先识别登录路径，避免把登录页误当后台首页。
  try {
    const 地址 = new URL(String(url || ''));
    return 地址.hostname === 'mms.pinduoduo.com' && 地址.pathname.startsWith('/login');
  } catch {
    return true;
  }
}

async function 页面包含拼多多后台特征(page) {
  // 解决：部分登录跳转 URL 先变化，正文出现商家后台后才算可操作。
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return String(text || '').includes('商家后台') && !String(text || '').includes('扫码登录');
}

async function 等待拼多多登录完成(page, 店铺配置, 选项 = {}) {
  // 解决：用户处理验证时程序只观察状态，不重复点击登录导致验证失败。
  const {
    timeoutMs = 15 * 60_000,
    intervalMs = 1000,
  } = 选项;
  let 已填充 = false;
  let 上次提示 = '';
  let 上次周期日志时间 = 0;

  return 等待直到(page, async () => {
    const 当前地址 = page.url();
    if (是拼多多业务页面(当前地址) && await 页面包含拼多多后台特征(page)) {
      打印日志('拼多多登录', '登录状态', `业务页面已就绪：${店铺配置.name}`);
      return true;
    }

    if (!已填充 && 是拼多多登录页面(当前地址)) {
      const 填充结果 = await 准备拼多多账号密码登录(page, 店铺配置);
      已填充 = 已填充 || 填充结果.filled;
      if (填充结果.message && 填充结果.message !== 上次提示) {
        上次提示 = 填充结果.message;
        打印日志('拼多多登录', '登录状态', 填充结果.message);
      }
    }

    const 当前时间 = Date.now();
    if (当前时间 - 上次周期日志时间 >= 5000) {
      上次周期日志时间 = 当前时间;
      打印日志('拼多多登录', '登录状态', `等待人工完成验证：${店铺配置.name}`);
    }
    return false;
  }, {
    timeoutMs,
    intervalMs,
    超时消息: `等待拼多多店铺「${店铺配置.name}」登录完成超时，请重新执行登录。`,
  });
}

module.exports = {
  是拼多多业务页面,
  是拼多多登录页面,
  页面包含拼多多后台特征,
  等待拼多多登录完成,
};
