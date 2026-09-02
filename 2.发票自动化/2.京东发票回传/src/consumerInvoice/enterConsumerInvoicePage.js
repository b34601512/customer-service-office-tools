const { 打印日志 } = require('../common/logger');
const { 等待直到 } = require('../browser/dynamicWait');
const { 提交京东登录表单 } = require('../browser/jdLoginForm');
const { 目标页面地址, 是目标地址页面, 是目标地址或登录跳转页面 } = require('../browser/targetPageIdentity');
const {
  禁用常见遮挡浮层,
  获取顶部全部标签点击点,
  获取顶部待开票标签点击点,
} = require('./allInvoiceTab');

const 默认业务页等待毫秒 = 60_000;
const 默认人工登录等待毫秒 = 10 * 60_000;

function 规范化页面文本(文本) {
  // 解决：页面标题判断只看稳定文字，避免京东组件换行影响识别。
  return String(文本 || '').replace(/\s+/g, ' ').trim();
}

async function 读取页面正文(page) {
  // 解决：进门函数统一读取正文，避免扫描链路里散落页面状态读取。
  return page.locator('body').innerText();
}

async function 读取页面标题(page) {
  // 解决：错误信息里保留浏览器标题，方便判断是否被京东带到其它业务页。
  return page.title();
}

function 有消费者发票标题(页面文本) {
  // 解决：目标页内部还要有消费者发票标题，避免同路径异常壳子误判成功。
  const 文本 = 规范化页面文本(页面文本);
  return 文本.includes('消费者发票管理') || 文本.includes('消费者发票');
}

function 是京东二次验证地址(url) {
  // 解决：短信和身份验证页只等待用户处理，禁止自动跳过安全验证。
  try {
    const 地址 = new URL(url);
    return 地址.hostname.includes('aq.jd.com') || 地址.pathname.includes('/certified');
  } catch {
    return false;
  }
}

async function 读取顶部发票标签状态(page) {
  // 解决：就绪判断复用真实点击前的标签定位规则，避免判断和执行分叉。
  await 禁用常见遮挡浮层(page);
  const 全部标签 = await 获取顶部全部标签点击点(page);
  const 待开票标签 = await 获取顶部待开票标签点击点(page);
  return {
    hasAllTab: Boolean(全部标签?.ok),
    hasPendingTab: Boolean(待开票标签?.ok),
    allTabMessage: 全部标签?.message || '',
    pendingTabMessage: 待开票标签?.message || '',
  };
}

function 构建页面状态摘要(状态) {
  // 解决：失败时把判断条件一次说清楚，避免只看到模糊的超时。
  return [
    `URL=${状态.pageUrl || '未知'}`,
    `标题=${状态.pageTitle || '未知'}`,
    `目标地址=${状态.isTargetUrl ? '是' : '否'}`,
    `目标登录跳转=${状态.isLoginRedirectUrl ? '是' : '否'}`,
    `二次验证=${状态.isVerificationUrl ? '是' : '否'}`,
    `页面标题=${状态.hasTitle ? '有' : '无'}`,
    `全部标签=${状态.hasAllTab ? '有' : '无'}`,
    `待开票标签=${状态.hasPendingTab ? '有' : '无'}`,
  ].join('；');
}

async function 读取消费者发票入口状态(page, 目标地址 = 目标页面地址) {
  // 解决：唯一入口只按当前真实页面区分业务、登录、验证和其它页面。
  const pageUrl = page.url();
  const pageTitle = await 读取页面标题(page);
  const isTargetUrl = 是目标地址页面(pageUrl, 目标地址);
  const isLoginRedirectUrl = !isTargetUrl && 是目标地址或登录跳转页面(pageUrl, 目标地址);
  const isVerificationUrl = 是京东二次验证地址(pageUrl);
  if (!isTargetUrl) {
    return {
      ready: false,
      pageUrl,
      pageTitle,
      isTargetUrl,
      isLoginRedirectUrl,
      isVerificationUrl,
      hasTitle: false,
      hasAllTab: false,
      hasPendingTab: false,
    };
  }

  const 页面文本 = await 读取页面正文(page);
  const hasTitle = 有消费者发票标题(页面文本);
  const 标签状态 = hasTitle
    ? await 读取顶部发票标签状态(page)
    : { hasAllTab: false, hasPendingTab: false, allTabMessage: '', pendingTabMessage: '' };

  return {
    ready: hasTitle && 标签状态.hasAllTab && 标签状态.hasPendingTab,
    pageUrl,
    pageTitle,
    isTargetUrl,
    isLoginRedirectUrl,
    isVerificationUrl,
    hasTitle,
    ...标签状态,
  };
}

async function 回到消费者发票目标页(page, 目标地址) {
  // 解决：登录完成落在其它页面时，统一回到配置的消费者发票页。
  打印日志('页面导航', '消费者发票入口', `准备进入目标页：${目标地址}`);
  await page.goto(目标地址, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
}

function 构建登录态失效错误(状态) {
  // 解决：后台模式遇到登录页时立即交给可见登录流程。
  return new Error(`登录态失效：京东已跳转登录页。最后状态：${构建页面状态摘要(状态)}`);
}

async function 进入消费者发票页面(page, 选项 = {}) {
  // 解决：业务页确认和登录恢复共用唯一进门流程，不再产生两套页面判断。
  const {
    目标地址 = 目标页面地址,
    允许人工登录 = false,
    店铺配置 = null,
    timeoutMs = 允许人工登录 ? 默认人工登录等待毫秒 : 默认业务页等待毫秒,
    intervalMs = 300,
  } = 选项;
  let 最后状态 = null;
  let 上次纠偏地址 = '';
  let 登录表单已提交 = false;
  let 已提示二次验证 = false;
  let 已提示业务页加载 = false;

  const 等待结果 = await 等待直到(page, async () => {
    最后状态 = await 读取消费者发票入口状态(page, 目标地址);
    if (最后状态.ready) {
      打印日志('页面导航', '消费者发票入口', '消费者发票页已确认');
      return { kind: 'ready', state: 最后状态 };
    }

    if (最后状态.isLoginRedirectUrl) {
      if (!允许人工登录) {
        return { kind: 'login-required', state: 最后状态 };
      }
      if (!登录表单已提交) {
        try {
          await 提交京东登录表单(page, 店铺配置);
          登录表单已提交 = true;
        } catch (error) {
          return { kind: 'error', error };
        }
      }
      return null;
    }

    if (最后状态.isVerificationUrl) {
      if (!已提示二次验证) {
        已提示二次验证 = true;
        打印日志('登录流程', '京东安全验证', '请完成京东短信或身份验证，完成后任务会自动继续');
      }
      await page.bringToFront().catch(() => {});
      return null;
    }

    if (最后状态.isTargetUrl) {
      if (!已提示业务页加载) {
        已提示业务页加载 = true;
        打印日志('页面导航', '消费者发票入口', '等待消费者发票页真实内容就绪');
      }
      return null;
    }

    if (上次纠偏地址 !== 最后状态.pageUrl) {
      上次纠偏地址 = 最后状态.pageUrl;
      await 回到消费者发票目标页(page, 目标地址);
    }
    return null;
  }, {
    timeoutMs,
    intervalMs,
    超时消息: '进入消费者发票页超时。',
  }).catch((错误) => {
    if (!最后状态) throw 错误;
    throw new Error(`${错误.message} 最后状态：${构建页面状态摘要(最后状态)}`);
  });

  if (等待结果.kind === 'login-required') {
    throw 构建登录态失效错误(等待结果.state);
  }
  if (等待结果.kind === 'error') {
    throw 等待结果.error;
  }
  return 等待结果.state;
}

module.exports = {
  默认业务页等待毫秒,
  默认人工登录等待毫秒,
  进入消费者发票页面,
  读取消费者发票入口状态,
  构建页面状态摘要,
};
