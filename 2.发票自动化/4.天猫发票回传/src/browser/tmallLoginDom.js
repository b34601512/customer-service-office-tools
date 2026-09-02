const { 打印日志 } = require('../common/logger');

const 密码登录切换选择器列表 = [
  'a.password-login-tab-item',
  'button:has-text("密码登录")',
  'a:has-text("密码登录")',
  'button:has-text("账号登录")',
  'a:has-text("账号登录")',
  'button:has-text("账户登录")',
  'a:has-text("账户登录")',
  'text=密码登录',
];

const 账号输入框选择器列表 = [
  '#fm-login-id',
  'input[name="fm-login-id"]',
  'input[aria-label="账号名/邮箱/手机号"]',
  'input[placeholder*="账号"]',
  'input[placeholder*="邮箱"]',
  'input[placeholder*="手机号"]',
  'input[type="text"]',
];

const 密码输入框选择器列表 = [
  '#fm-login-password',
  'input[name="fm-login-password"]',
  'input[aria-label="请输入登录密码"]',
  'input[placeholder*="密码"]',
  'input[type="password"]',
];

const 登录按钮选择器列表 = [
  'button[type="submit"]',
  'button.fm-button',
  '.fm-button',
  'button:has-text("登录")',
  'a:has-text("登录")',
  'input[type="submit"]',
];

function 读取locator第一个(locator) {
  // 解决：兼容真实 Playwright locator.first() 和测试桩 first 属性两种形态。
  if (!locator) return locator;
  if (typeof locator.first === 'function') return locator.first();
  return locator.first || locator;
}

async function 定位第一个可见元素(容器, 选择器列表) {
  // 解决：天猫登录页会在主页面或 iframe 内改版，选择器按真实语义逐个命中。
  for (const 选择器 of 选择器列表) {
    try {
      const 元素 = 读取locator第一个(容器.locator(选择器));
      if (await 元素.count() === 0) continue;
      if (await 元素.isVisible().catch(() => false)) return 元素;
    } catch {
      continue;
    }
  }
  return null;
}

async function 容器存在登录表单(容器) {
  // 解决：先识别表单所在容器，再在这个容器里填账号密码。
  return Boolean(
    await 定位第一个可见元素(容器, 账号输入框选择器列表)
    || await 定位第一个可见元素(容器, 密码输入框选择器列表)
    || await 定位第一个可见元素(容器, 密码登录切换选择器列表),
  );
}

async function 查找天猫登录表单容器(page) {
  // 解决：实测天猫登录表单位于 iframe#alibaba-login-box，不能只查主页面。
  if (await 容器存在登录表单(page)) {
    return page;
  }
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if (await 容器存在登录表单(frame)) {
      return frame;
    }
  }
  return null;
}

async function 尝试切换到密码登录(容器) {
  // 解决：默认可能展示扫码或短信登录，必须先切到密码登录才能自动填充。
  const 切换按钮 = await 定位第一个可见元素(容器, 密码登录切换选择器列表);
  if (!切换按钮) {
    return false;
  }
  const className = String(await 切换按钮.getAttribute('class').catch(() => '') || '');
  if (className.includes('active') || className.includes('selected') || className.includes('checked')) {
    return true;
  }
  await 切换按钮.click().catch(() => {});
  return true;
}

async function 尝试点击天猫登录按钮(容器) {
  // 解决：账号密码已填好后直接提交登录，只把滑块、短信、扫码等真实验证留给人工。
  const 登录按钮 = await 定位第一个可见元素(容器, 登录按钮选择器列表);
  if (!登录按钮) {
    return false;
  }
  const 禁用属性 = String(await 登录按钮.getAttribute('disabled').catch(() => '') || '');
  const ariaDisabled = String(await 登录按钮.getAttribute('aria-disabled').catch(() => '') || '');
  const className = String(await 登录按钮.getAttribute('class').catch(() => '') || '');
  if (禁用属性 || ariaDisabled === 'true' || /\bdisabled\b/i.test(className)) {
    return false;
  }
  await 登录按钮.click();
  return true;
}

async function 准备天猫账号密码登录(page, 店铺配置) {
  // 解决：自动完成账号密码提交，滑块、验证码、短信验证保留给人工处理。
  const 账号 = String(店铺配置?.username || '').trim();
  const 密码 = String(店铺配置?.password || '');
  if (!账号 || !密码) {
    return {
      filled: false,
      message: `店铺「${店铺配置?.name || 店铺配置?.id || ''}」未配置账号密码，请人工输入。`,
    };
  }

  const 表单容器 = await 查找天猫登录表单容器(page);
  if (!表单容器) {
    return {
      filled: false,
      message: '当前页面还没有出现天猫账号密码登录表单。',
    };
  }

  await 尝试切换到密码登录(表单容器);
  const 账号输入框 = await 定位第一个可见元素(表单容器, 账号输入框选择器列表);
  const 密码输入框 = await 定位第一个可见元素(表单容器, 密码输入框选择器列表);
  if (!账号输入框 || !密码输入框) {
    return {
      filled: false,
      message: '天猫登录表单已出现，但账号或密码输入框还未就绪。',
    };
  }

  await 账号输入框.fill(账号);
  await 密码输入框.fill(密码);
  const 已点击登录 = await 尝试点击天猫登录按钮(表单容器);
  await page.bringToFront().catch(() => {});
  打印日志('天猫登录', '登录表单', `已填入账号密码：${店铺配置.name || 店铺配置.id}`);
  return {
    filled: true,
    clickedLogin: 已点击登录,
    message: 已点击登录
      ? `店铺「${店铺配置.name || 店铺配置.id}」账号密码已填入并已点击登录，如出现验证请人工完成。`
      : `店铺「${店铺配置.name || 店铺配置.id}」账号密码已填入，但没有找到可点击登录按钮，请人工确认页面。`,
  };
}

module.exports = {
  密码登录切换选择器列表,
  账号输入框选择器列表,
  密码输入框选择器列表,
  登录按钮选择器列表,
  定位第一个可见元素,
  查找天猫登录表单容器,
  尝试点击天猫登录按钮,
  准备天猫账号密码登录,
};
