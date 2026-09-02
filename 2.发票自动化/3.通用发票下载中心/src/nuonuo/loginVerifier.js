const fs = require('fs');
const { 登录态文件路径, 截图目录, 诺诺登录状态文件路径 } = require('../common/paths');
const { 初始化运行目录 } = require('../common/fs');
const { 打印日志 } = require('../common/logger');
const {
  创建诺诺浏览器会话,
  创建或复用诺诺浏览器会话,
  获取当前共享诺诺浏览器会话,
  设置当前共享诺诺浏览器会话,
  关闭诺诺浏览器会话,
} = require('./nuonuoBrowserSession');
const { 诺诺开票记录页地址, 查询诺诺主体列表 } = require('./invoiceApiDownloader');
const path = require('path');

let 待人工登录会话 = null;

function 写入诺诺登录状态(状态, 标签, 详情 = '') {
  try {
    fs.writeFileSync(诺诺登录状态文件路径, JSON.stringify({
      status: 状态,
      label: 标签,
      detail: 详情,
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
  } catch {
    // 状态文件只是跨进程提示，写入失败不能阻断真实登录校验。
  }
}

async function 读取页面摘要(page) {
  // 这个函数解决登录失败时能留下页面证据的问题。
  return {
    title: await page.title().catch(() => ''),
    url: page.url(),
    bodyText: String(await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 800),
  };
}

function 判断是否已进入工作台(pageUrl) {
  // 这个函数解决只凭页面文字误判登录成功的问题。
  return pageUrl.includes('work.nuonuo.com') && !/login|usercenter\/allow\/login/i.test(pageUrl);
}

async function 判断页面是否显示密码输入框(page) {
  // 这个函数解决登录页判断复用同一套可见密码框标准，避免多个分支各写一遍选择器。
  return page.locator('input[type="password"]').first().isVisible().catch(() => false);
}

async function 等待页面进入登录判定状态(page, timeoutMs = 15_000) {
  // 这个函数解决页面仍在加载时不能过早判定为需要人工完整登录。
  const deadline = Date.now() + Math.max(1000, Math.min(timeoutMs, 15_000));
  while (Date.now() < deadline) {
    if (判断是否已进入工作台(page.url())) return 'workbench';
    if (await 判断页面是否显示密码输入框(page)) return 'login-form';
    await page.waitForTimeout(300).catch(() => {});
  }
  return 'unknown';
}

async function 验证诺诺发票会话(page, options = {}) {
  // 这个函数解决登录检查必须按真实下载依赖校验，而不是只看工作台 URL。
  const {
    timeoutMs = 30_000,
    queryCompanyList = 查询诺诺主体列表,
  } = options;
  await page.goto(诺诺开票记录页地址, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 20_000) }).catch(() => {});
  if (!判断是否已进入工作台(page.url())) {
    throw new Error('诺诺登录态已失效，请先完成网页登录。');
  }
  const 主体信息 = await queryCompanyList(page);
  if (!Array.isArray(主体信息?.companies) || !主体信息.companies.length) {
    throw new Error('诺诺登录检查失败：当前账号没有可用开票主体。');
  }
  return 主体信息;
}

async function 保存真实可用登录态(context, page, timeoutMs) {
  // 这个函数解决只有真实发票接口可用时才覆盖本地登录态文件，避免保存半失效状态。
  const 主体信息 = await 验证诺诺发票会话(page, { timeoutMs });
  await context.storageState({ path: 登录态文件路径 });
  return 主体信息;
}

async function 关闭待人工登录会话() {
  // 这个函数解决人工登录窗口验证完成后浏览器资源必须释放的问题。
  const session = 待人工登录会话;
  待人工登录会话 = null;
  if (!session) return;
  await 关闭诺诺浏览器会话(session);
}

async function 关闭当前登录会话(session, 是否待人工会话) {
  // 这个函数解决新会话和待人工会话在成功后都能按来源正确释放资源。
  if (是否待人工会话) {
    await 关闭待人工登录会话();
    return;
  }
  await 关闭诺诺浏览器会话(session);
}

async function 创建登录会话({ headless }) {
  // 这个函数解决诺诺登录 Cookie 必须跨服务重启保留的问题。
  return 创建诺诺浏览器会话({ headless, useSavedAuthState: true });
}

async function 打开干净登录页(session, config, timeoutMs) {
  // 这个函数解决旧登录态失效后清理当前会话，再进入可自动填账号密码的登录页。
  await session.context?.clearCookies().catch(() => {});
  await session.page?.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await 等待页面进入登录判定状态(session.page, timeoutMs);
  return { context: session.context, page: session.page };
}

async function 获取有效待人工登录会话() {
  // 这个函数解决用户手动关闭登录窗口后旧会话不能继续复用的问题。
  if (!待人工登录会话) return null;
  if (待人工登录会话.page?.isClosed()) {
    await 关闭待人工登录会话();
    return null;
  }
  return 待人工登录会话;
}

async function 定位第一个可见元素(容器, 选择器列表) {
  // 这个函数解决诺诺登录页字段选择器变化时按可见元素优先匹配的问题。
  for (const 选择器 of 选择器列表) {
    const 元素 = 容器.locator(选择器).first();
    if (await 元素.count() === 0) continue;
    if (await 元素.isVisible().catch(() => false)) return 元素;
  }
  return null;
}

async function 填写账号密码(page, config) {
  // 这个函数解决只把已配置的账号密码填入诺诺登录页，不把订单号误填到登录框。
  const 账号输入框 = await 定位第一个可见元素(page, [
    '#usernameInput',
    'input[name="username"]',
    'input[placeholder*="账号"]',
    'input[placeholder*="用户名"]',
    'input[placeholder*="手机号"]',
    'input[type="text"]',
  ]);
  const 密码输入框 = await 定位第一个可见元素(page, [
    'input[name="password"]',
    'input[type="password"]',
    'input[placeholder*="密码"]',
  ]);
  if (!账号输入框 || !密码输入框) {
    throw new Error('诺诺登录页没有找到账号或密码输入框。');
  }
  await 账号输入框.fill(config.username);
  await 密码输入框.fill(config.password);
}

async function 是否存在验证码输入框(page) {
  // 这个函数解决有验证码时必须交给人工处理，不能猜测提交登录。
  const 验证码输入框 = await 定位第一个可见元素(page, [
    'input[name*="vcode"]',
    'input[name*="verify"]',
    'input[placeholder*="验证码"]',
  ]);
  return Boolean(验证码输入框);
}

async function 尝试自动提交无验证码登录(page) {
  // 这个函数解决没有验证码输入框时可以推进一次登录，不把固定等待当成功依据。
  if (await 是否存在验证码输入框(page)) return false;
  const 登录按钮 = await 定位第一个可见元素(page, [
    '#m-login-btn',
    '#loginBtn',
    'button:has-text("立即登录")',
    'button:has-text("登录")',
    'a:has-text("立即登录")',
    'a:has-text("登录")',
    'button[type="submit"]',
  ]);
  if (!登录按钮) return false;
  await Promise.all([
    page.waitForURL((url) => 判断是否已进入工作台(url.href), { timeout: 8000 }).catch(() => null),
    登录按钮.click(),
  ]);
  return 判断是否已进入工作台(page.url());
}

async function 构建等待人工登录结果(page, message, screenshotPath) {
  // 这个函数解决命令行菜单能区分“失败”和“等待人工登录”两种不同状态。
  写入诺诺登录状态('checking', '等待人工登录', message);
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
  return {
    ok: false,
    requiresManualLogin: true,
    message,
    screenshotPath,
    ...(await 读取页面摘要(page)),
  };
}

async function 构建登录通过结果(context, page, session, 是否待人工会话, timeoutMs, reusedAuthState, keepBrowserOpenOnSuccess = false) {
  // 这个函数解决所有登录成功分支都必须先通过发票接口真实校验。
  const 主体信息 = await 保存真实可用登录态(context, page, timeoutMs);
  写入诺诺登录状态('ready', '可用', `主体 ${主体信息.companies.length} 个`);
  const 摘要 = await 读取页面摘要(page);
  if (keepBrowserOpenOnSuccess) {
    设置当前共享诺诺浏览器会话(session);
  } else {
    await 关闭当前登录会话(session, 是否待人工会话);
  }
  return { ok: true, reusedAuthState, invoiceSubjectCount: 主体信息.companies.length, ...摘要 };
}

async function 无头探测诺诺登录(config, options = {}) {
  // 解决：首页刷新时用已保存登录态做一次无头真实校验，不弹浏览器也能反映“已经登录”。
  const {
    timeoutMs = 15_000,
    createSession = () => 创建诺诺浏览器会话({ headless: true, useSavedAuthState: true }),
    closeSession = 关闭诺诺浏览器会话,
    verify = 验证诺诺发票会话,
  } = options;
  if (!config?.username || !config?.password) {
    return { ok: false, message: '诺诺账号或密码未配置。' };
  }
  初始化运行目录();
  const session = await createSession();
  try {
    const 主体信息 = await verify(session.page, { timeoutMs });
    return { ok: true, invoiceSubjectCount: 主体信息.companies.length };
  } catch (error) {
    return { ok: false, message: String(error?.message || error || '登录态探测失败') };
  } finally {
    await closeSession(session).catch(() => {});
  }
}

async function 验证诺诺登录(config, options = {}) {
  // 这个函数验证诺诺会话是否能进入真实发票下载链路。
  初始化运行目录();
  const {
    headless = false,
    timeoutMs = 30_000,
    keepBrowserOpenOnManualLogin = false,
    keepBrowserOpenOnSuccess = false,
  } = options;
  if (!config?.username || !config?.password) {
    写入诺诺登录状态('error', '失效', '诺诺账号或密码未配置。');
    throw new Error('诺诺账号或密码未配置。');
  }

  const 已有会话 = await 获取有效待人工登录会话() || 获取当前共享诺诺浏览器会话();
  const session = 已有会话 || await 创建或复用诺诺浏览器会话({ headless, useSavedAuthState: true });
  const { browser } = session;
  let { context, page } = session;
  const 截图路径 = path.join(截图目录, 'nuonuo-login-check.png');
  try {
    if (!已有会话) {
      打印日志('诺诺登录', '登录验证', `打开发票系统：${config.targetUrl}`);
      await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await 等待页面进入登录判定状态(page, timeoutMs);
    } else {
      await page.bringToFront().catch(() => {});
      await 等待页面进入登录判定状态(page, timeoutMs);
    }

    let 现有会话校验错误 = null;
    if (判断是否已进入工作台(page.url()) || !await 判断页面是否显示密码输入框(page)) {
      try {
        return await 构建登录通过结果(context, page, session, Boolean(已有会话), timeoutMs, true, keepBrowserOpenOnSuccess);
      } catch (error) {
        现有会话校验错误 = error;
        打印日志('诺诺登录', '真实校验', `现有登录态不可用：${error.message}`);
        ({ context, page } = await 打开干净登录页(session, config, timeoutMs));
      }
    }

    if (判断是否已进入工作台(page.url()) && !await 判断页面是否显示密码输入框(page)) {
      try {
        return await 构建登录通过结果(context, page, session, Boolean(已有会话), timeoutMs, false, keepBrowserOpenOnSuccess);
      } catch (error) {
        现有会话校验错误 = error;
        打印日志('诺诺登录', '真实校验', `干净登录上下文仍不可用：${error.message}`);
      }
    }

    if (!await 判断页面是否显示密码输入框(page)) {
      if (keepBrowserOpenOnManualLogin) {
        待人工登录会话 = session;
        const 原因 = 现有会话校验错误 ? `诺诺登录态真实校验失败：${现有会话校验错误.message}，` : '';
        return 构建等待人工登录结果(page, `${原因}请在浏览器里完成登录后，再回到命令行菜单执行“检查诺诺登录”。`, 截图路径);
      }
      throw 现有会话校验错误 || new Error('诺诺登录页没有显示密码输入框，不能判定登录成功。');
    }

    await 填写账号密码(page, config);
    if (await 尝试自动提交无验证码登录(page)) {
      return 构建登录通过结果(context, page, session, Boolean(已有会话), timeoutMs, false, keepBrowserOpenOnSuccess);
    }

    if (keepBrowserOpenOnManualLogin) {
      待人工登录会话 = session;
      return 构建等待人工登录结果(page, '已打开诺诺登录窗口并填入账号密码，请在浏览器里完成验证码或确认后，再回到命令行菜单执行“检查诺诺登录”。', 截图路径);
    }

    throw new Error('诺诺登录页需要先确认隐私政策或图片验证码，当前只完成了账号密码填充，不能判定登录成功。');
  } catch (error) {
    写入诺诺登录状态('error', '失效', error.message);
    await page.screenshot({ path: 截图路径, fullPage: false }).catch(() => {});
    const 摘要 = await 读取页面摘要(page);
    if (!keepBrowserOpenOnManualLogin) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    } else {
      待人工登录会话 = session;
    }
    return {
      ok: false,
      message: error.message,
      screenshotPath: 截图路径,
      ...摘要,
    };
  }
}

module.exports = {
  等待页面进入登录判定状态,
  判断是否已进入工作台,
  验证诺诺发票会话,
  关闭待人工登录会话,
  写入诺诺登录状态,
  验证诺诺登录,
  无头探测诺诺登录,
};
