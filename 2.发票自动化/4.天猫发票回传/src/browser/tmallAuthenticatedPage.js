const { 等待直到 } = require('./dynamicWait');
const { 准备天猫账号密码登录 } = require('./tmallLoginDom');
const { 读取天猫业务后台地址 } = require('./tmallBusinessUrl');
const { 打印日志 } = require('../common/logger');

function 是天猫业务页面(url) {
  // 解决：天猫登录页标题和千牛后台标题可能相同，所以优先按真实业务域名判断。
  try {
    const 地址 = new URL(String(url || ''));
    return 地址.hostname === 'myseller.taobao.com' && 地址.pathname.includes('/home.htm');
  } catch {
    return false;
  }
}

function 是天猫已登录地址(url) {
  // 解决：已登录后可能落在 myseller 域的错误页或中转页（如 error.htm），
  // 只要不是登录域就视为登录态已建立，由程序主动导航回业务后台。
  try {
    const 地址 = new URL(String(url || ''));
    return 地址.hostname === 'myseller.taobao.com';
  } catch {
    return false;
  }
}

function 是天猫登录页面(url) {
  // 解决：登录态检测先识别登录域名，避免把登录页误当业务页。
  try {
    const 地址 = new URL(String(url || ''));
    return 地址.hostname.includes('loginmyseller.taobao.com') || 地址.hostname.includes('havanalogin.taobao.com');
  } catch {
    return true;
  }
}

async function 等待天猫登录完成(page, 店铺配置, 选项 = {}) {
  // 解决：用户处理验证时程序持续观察页面状态，而不是重复提交导致验证失败；
  // 登录完成后若落在错误页/中转页，自动导航回调用方期望的目标页，避免卡在 error.htm 或后台首页。
  const {
    timeoutMs = 15 * 60_000,
    intervalMs = 1000,
    目标地址 = 读取天猫业务后台地址(店铺配置),
    登录稳定等待毫秒 = 30_000,
  } = 选项;
  let 已填充 = false;
  let 已尝试导航 = false;
  let 已登录时间 = 0;
  let 上次提示 = '';
  let 上次周期日志时间 = 0;

  return 等待直到(page, async () => {
    const 当前地址 = page.url();
    if (是天猫业务页面(当前地址)) {
      打印日志('天猫登录', '登录状态', `业务页面已就绪：${店铺配置.name}`);
      return true;
    }

    if (是天猫已登录地址(当前地址)) {
      // 登录态已建立但不在业务页（error.htm / 中转页 / 后台首页）：主动导航回目标页一次。
      if (!已尝试导航) {
        已尝试导航 = true;
        已登录时间 = Date.now();
        打印日志('天猫登录', '登录状态', `登录态已建立，正在进入目标页：${目标地址}`);
        await page.goto(目标地址, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
      }
      if (是天猫业务页面(page.url())) {
        打印日志('天猫登录', '登录状态', `已进入业务页面：${店铺配置.name}`);
        return true;
      }
      // 目标页仍在初始化或返回错误页：给会话一段稳定期，避免过早判定成功导致后续跳回首页。
      if (Date.now() - 已登录时间 > 登录稳定等待毫秒) {
        打印日志('天猫登录', '登录状态', `目标页暂未就绪（当前地址：${page.url()}），登录态已保存，交由后续流程处理`);
        return true;
      }
      return false;
    }

    if (!已填充) {
      const 填充结果 = await 准备天猫账号密码登录(page, 店铺配置);
      已填充 = 已填充 || 填充结果.filled;
      if (填充结果.message && 填充结果.message !== 上次提示) {
        上次提示 = 填充结果.message;
        打印日志('天猫登录', '登录状态', 填充结果.message);
      }
    }

    const 当前时间 = Date.now();
    if (当前时间 - 上次周期日志时间 >= 5000) {
      上次周期日志时间 = 当前时间;
      打印日志('天猫登录', '登录状态', `等待人工完成验证：${店铺配置.name}`);
    }
    return false;
  }, {
    timeoutMs,
    intervalMs,
    超时消息: `等待天猫店铺「${店铺配置.name}」登录完成超时，请重新执行登录。`,
  });
}

module.exports = {
  是天猫业务页面,
  是天猫已登录地址,
  是天猫登录页面,
  等待天猫登录完成,
};
