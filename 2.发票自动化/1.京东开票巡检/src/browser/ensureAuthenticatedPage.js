const { 打印日志 } = require('../common/logger');
const { 等待直到 } = require('./dynamicWait');
const { 目标页面地址 } = require('./openTargetPage');

const 登录关键词 = ['扫码登录', '京东登录', '登录京东', '短信验证码登录', '账号登录'];
const 二次验证关键词 = ['认证魔方', '身份认证', '手机短信验证码', '为确认是您本人操作', '安全验证'];
const 无权限关键词 = ['无权限', '暂无权限', '访问受限', '您暂无权限'];
const 京东登录凭证Cookie名称 = new Set(['thor', 'pin']);
const 旧版开票治理路径 = '/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html';
const 新版开票治理路径 = '/szweb/view/service/create-invoice-governance-temp.html';

function 解码路径(路径) {
  // 解决：京东新版页面会把旧路径塞进 query 参数，统一解码后再判断业务签名。
  try {
    return decodeURIComponent(String(路径 || ''));
  } catch {
    return String(路径 || '');
  }
}

function 是商智业务域名(hostname) {
  // 解决：京东商智近期从 sz.jd.com 重定向到 jdsz.jd.com，两个域名都属于同一业务页。
  return ['sz.jd.com', 'jdsz.jd.com'].includes(String(hostname || '').toLowerCase());
}

function 是目标业务页面(url, 目标地址 = 目标页面地址) {
  // 解决：按开票治理业务签名判断登录成功，兼容京东新旧 URL，避免登录后被误判成中间页。
  try {
    const 当前地址对象 = new URL(url);
    const 目标地址对象 = new URL(目标地址);
    const 当前路径 = 解码路径(当前地址对象.pathname);
    const 目标路径 = 解码路径(目标地址对象.pathname);

    if (当前地址对象.hostname === 目标地址对象.hostname && 当前路径 === 目标路径) {
      return true;
    }

    if (!是商智业务域名(当前地址对象.hostname)) {
      return false;
    }

    if (当前路径 === 目标路径 || 当前路径 === 旧版开票治理路径) {
      return true;
    }

    if (当前路径 !== 新版开票治理路径) {
      return false;
    }

    const sz参数路径 = 解码路径(当前地址对象.searchParams.get('sz') || '');
    return sz参数路径 === 旧版开票治理路径 || 目标路径 === 旧版开票治理路径;
  } catch {
    return false;
  }
}

async function 读取页面文本(page) {
  // 解决：统一获取页面可见文本，避免登录态检测逻辑重复求值。
  return page.locator('body').innerText().catch(() => '');
}

function 是登录页面(url, 文本) {
  // 解决：通过地址和文案双重判断登录页，降低误判概率。
  const 合并文本 = `${url}\n${文本}`;

  try {
    const 地址对象 = new URL(url);
    if (地址对象.hostname.includes('passport.jd.com') || 地址对象.pathname.includes('/login')) {
      return true;
    }
  } catch {
    return true;
  }

  return 登录关键词.some((关键词) => 合并文本.includes(关键词));
}

function 是有效京东登录凭证Cookie(cookie, 当前时间秒 = Date.now() / 1000) {
  // 解决：只按京东认证 Cookie 的名称、域名和有效期判断，避免普通跟踪 Cookie 被误当成登录态。
  const cookie名称 = String(cookie?.name || '');
  const cookie域名 = String(cookie?.domain || '').toLowerCase();
  const 过期时间秒 = Number(cookie?.expires || -1);
  return 京东登录凭证Cookie名称.has(cookie名称)
    && (cookie域名 === 'jd.com' || cookie域名.endsWith('.jd.com'))
    && (过期时间秒 <= 0 || 过期时间秒 > 当前时间秒);
}

async function 存在京东登录凭证(page) {
  // 解决：导航前快速读取本地认证 Cookie；明确缺失时无需等待业务页三分钟后才暴露登录失效。
  const cookies = await page.context().cookies([
    'https://jd.com',
    'https://passport.jd.com',
    'https://sz.jd.com',
    'https://jdsz.jd.com',
  ]);
  return cookies.some((cookie) => 是有效京东登录凭证Cookie(cookie));
}

function 构建京东登录页地址(目标地址) {
  // 解决：登录凭证缺失时直接打开京东登录表单，并在成功后自动返回巡检目标页。
  return `https://passport.jd.com/new/login.aspx?ReturnUrl=${encodeURIComponent(目标地址)}`;
}

function 是无权限页面(文本) {
  // 解决：尽早识别账号权限问题，避免后面提取阶段才报模糊错误。
  return 无权限关键词.some((关键词) => 文本.includes(关键词));
}

function 是二次验证页面(url, 文本) {
  // 解决：把滑块后的短信二次验证页单独识别出来，避免轮询逻辑误判为已登录后自动跳页。
  const 合并文本 = `${url}\n${文本}`;

  try {
    const 地址对象 = new URL(url);
    if (地址对象.hostname.includes('aq.jd.com') || 地址对象.pathname.includes('/certified')) {
      return true;
    }
  } catch {
    return false;
  }

  return 二次验证关键词.some((关键词) => 合并文本.includes(关键词));
}

function 是已登录但不在目标页面(url, 文本, 目标地址 = 目标页面地址) {
  // 解决：只把真正的已登录中间页交给自动跳转，二次验证页必须完全交还给人工处理。
  return !是登录页面(url, 文本) && !是二次验证页面(url, 文本) && !是目标业务页面(url, 目标地址);
}

async function 定位第一个可见元素(page, 选择器列表) {
  // 解决：兼容不同登录页 DOM 结构，优先找到真正可见的输入框和按钮。
  for (const 选择器 of 选择器列表) {
    const 元素 = page.locator(选择器).first();
    if (await 元素.count() === 0) {
      continue;
    }

    if (await 元素.isVisible().catch(() => false)) {
      return 元素;
    }
  }

  return null;
}

async function 容器里存在可见登录输入框(容器) {
  // 解决：统一判断当前页面或 iframe 里是否已经出现可直接填写的账号登录输入框。
  const 账号输入框 = 容器.locator('#loginname, input[name="loginname"]').first();
  if (await 账号输入框.count() === 0) {
    return false;
  }

  return 账号输入框.isVisible().catch(() => false);
}

async function 容器里存在登录表单特征(容器) {
  // 解决：在输入框还没完全可见前，先识别出登录弹层本体，避免因为时序抖动直接漏判。
  const 账号输入框 = 容器.locator('#loginname, input[name="loginname"]').first();
  if (await 账号输入框.count() > 0) {
    return true;
  }

  const 账户登录按钮 = await 定位第一个可见元素(容器, [
    'a:has-text("账户登录")',
    'button:has-text("账户登录")',
    'a:has-text("密码登录")',
    'button:has-text("密码登录")',
    'text=账户登录',
    'text=密码登录',
  ]);
  if (账户登录按钮) {
    return true;
  }

  const 登录提交按钮 = 容器.locator('#loginsubmit, a#loginsubmit').first();
  if (await 登录提交按钮.count() > 0) {
    return true;
  }

  return false;
}

async function 查找登录表单容器(page) {
  // 解决：兼容登录表单出现在主页面或 iframe 弹层里的两种情况，并允许先识别弹层再切换标签。
  if (await 容器里存在登录表单特征(page)) {
    return page;
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue;
    }

    if (await 容器里存在登录表单特征(frame)) {
      return frame;
    }
  }

  return null;
}

async function 点击商智顶部登录(page) {
  // 解决：落地页未直接展示表单时，先自动点击右上角登录拉起京东登录弹层。
  const 登录按钮 = await 定位第一个可见元素(page, [
    'a.login-btn',
    'button.login-btn',
    'a:has-text("登录")',
    'button:has-text("登录")',
  ]);

  if (!登录按钮) {
    return false;
  }

  打印日志('登录检测', '登录状态', '检测到商智未登录落地页，准备点击右上角登录');
  await 登录按钮.click();
  return true;
}

async function 获取登录表单容器(page) {
  // 解决：把“直接登录页”和“商智落地页弹层登录”统一收敛成同一个表单入口。
  let 已点击登录入口 = false;
  try {
    return await 等待直到(page, async () => {
      const 表单容器 = await 查找登录表单容器(page);
      if (表单容器) {
        await 切换到账户登录(page, 表单容器);
        if (await 容器里存在可见登录输入框(表单容器)) {
          return 表单容器;
        }
      }

      if (!已点击登录入口) {
        已点击登录入口 = await 点击商智顶部登录(page);
      }

      return null;
    }, {
      timeoutMs: 20_000,
      intervalMs: 250,
      超时消息: '等待登录表单出现超时，请确认当前页面是否真的打开了登录弹层。',
    });
  } catch (错误) {
    if (String(错误?.message || '').includes('等待登录表单出现超时')) {
      return null;
    }

    throw 错误;
  }
}

async function 切换到账户登录(page, 容器) {
  // 解决：优先切到账户密码登录，确保后续可以自动填入已保存的账号密码。
  if (await 容器里存在可见登录输入框(容器)) {
    return true;
  }

  const 账户登录按钮 = await 定位第一个可见元素(容器, [
    'a:has-text("账户登录")',
    'button:has-text("账户登录")',
    'a:has-text("密码登录")',
    'button:has-text("密码登录")',
    'text=账户登录',
    'text=密码登录',
  ]);

  if (!账户登录按钮) {
    return false;
  }

  const className = await 账户登录按钮.getAttribute('class').catch(() => '');
  if (/checked|active|selected/.test(String(className || ''))) {
    return true;
  }

  打印日志('登录检测', '登录状态', '准备切换到账户登录');
  await 账户登录按钮.click();
  await 等待直到(page, async () => {
    const 当前className = await 账户登录按钮.getAttribute('class').catch(() => '');
    if (/checked|active|selected/.test(String(当前className || ''))) {
      return true;
    }

    return 容器里存在可见登录输入框(容器);
  }, {
    timeoutMs: 10_000,
    intervalMs: 200,
    超时消息: '切换到账户登录后，账号密码输入框迟迟没有出现。',
  });
  return true;
}

async function 准备账号密码登录(page, 店铺配置, 选项 = {}) {
  // 解决：统一处理商智登录框展开、账号密码填充和可选的自动提交。
  const { 自动提交 = false } = 选项;
  const 账号 = String(店铺配置?.username || '').trim();
  const 密码 = String(店铺配置?.password || '').trim();
  if (!账号 || !密码) {
    return false;
  }

  const 登录表单容器 = await 获取登录表单容器(page);
  if (!登录表单容器) {
    打印日志('登录检测', '登录状态', `未找到登录表单容器：${page.url()}`);
    return false;
  }

  await 切换到账户登录(page, 登录表单容器);

  const 账号输入框 = await 定位第一个可见元素(登录表单容器, [
    '#loginname',
    'input[name="loginname"]',
    'input[placeholder*="账号"]',
    'input[placeholder*="用户名"]',
    'input[type="text"]',
  ]);
  const 密码输入框 = await 定位第一个可见元素(登录表单容器, [
    '#nloginpwd',
    'input[name="nloginpwd"]',
    'input[placeholder*="密码"]',
    'input[type="password"]',
  ]);
  if (!账号输入框 || !密码输入框) {
    打印日志('登录检测', '登录状态', '登录弹层已出现，但当前还没找到可填写的账号或密码输入框');
    return false;
  }

  打印日志('登录检测', '登录状态', `尝试自动填充账号密码：${店铺配置.name || 店铺配置.id}`);
  await 账号输入框.fill(账号);
  await 密码输入框.fill(密码);
  await page.bringToFront().catch(() => {});

  if (!自动提交) {
    打印日志('登录检测', '登录状态', '账号密码已填入，等待人工完成滑块/验证码并手动点击登录');
    return true;
  }

  const 登录按钮 = await 定位第一个可见元素(登录表单容器, [
    '#loginsubmit',
    'a#loginsubmit',
    'button[type="submit"]',
    '.login-btn',
    'button',
  ]);
  if (!登录按钮) {
    return false;
  }

  await 登录按钮.click();
  打印日志('登录检测', '登录状态', '已自动提交登录；若京东要求滑块、验证码或短信验证，窗口会继续等待人工处理');
  return true;
}

async function 等待业务页面就绪(page, 选项 = {}) {
  // 解决：首次登录后等待真正回到目标业务页，而不是提前误判成功。
  const { timeoutMs = 10 * 60_000, 目标地址 = 目标页面地址 } = 选项;
  let 上次跳转地址 = '';
  let 已提示二次验证 = false;
  let 已提示登录页等待 = false;
  await 等待直到(page, async () => {
    const 当前地址 = page.url();
    const 页面文本 = await 读取页面文本(page);

    if (是无权限页面(页面文本)) {
      throw new Error('当前京东账号没有该页面权限，请更换正确账号后重试。');
    }

    if (是二次验证页面(当前地址, 页面文本)) {
      if (!已提示二次验证) {
        已提示二次验证 = true;
        打印日志('登录检测', '登录状态', '检测到短信二次验证页面，系统已停止自动操作，请先完成短信验证。');
      }
      await page.bringToFront().catch(() => {});
      return false;
    }

    已提示二次验证 = false;

    if (是登录页面(当前地址, 页面文本)) {
      if (!已提示登录页等待) {
        已提示登录页等待 = true;
        打印日志('登录检测', '登录状态', '自动登录尚未完成；如页面要求滑块或验证码，请在当前窗口完成验证');
      }
      await page.bringToFront().catch(() => {});
      return false;
    }

    已提示登录页等待 = false;

    if (是已登录但不在目标页面(当前地址, 页面文本, 目标地址)) {
      if (上次跳转地址 !== 当前地址) {
        上次跳转地址 = 当前地址;
        打印日志('登录检测', '登录状态', `已识别登录成功，当前停留在其它页面，准备跳转目标页面：${目标地址}`);
        await page.goto(目标地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.bringToFront().catch(() => {});
      }
      return false;
    }

    if (!是登录页面(当前地址, 页面文本) && 是目标业务页面(当前地址, 目标地址)) {
      打印日志('登录检测', '登录状态', '业务页面地址已就绪，后续等待交给开票治理业务状态');
      return true;
    }

    return false;
  }, {
    timeoutMs,
    intervalMs: 300,
    超时消息: '等待登录完成超时，请重新执行登录流程。',
  });
}

async function 确保已登录(page, 选项 = {}) {
  // 解决：将首次登录和后续检查共用一套登录态校验逻辑。
  const {
    允许人工登录 = false,
    自动提交登录 = false,
    强制人工登录 = false,
    店铺配置 = null,
    目标地址 = 目标页面地址,
  } = 选项;
  const 已有登录凭证 = await 存在京东登录凭证(page);
  if (!已有登录凭证 || 强制人工登录) {
    // 解决：本地 cookie 只能证明凭证存在，服务端是否仍有效必须由页面重定向验证；
    // 强制人工登录用于静默检查发现登录页跳转后重开可见窗口，直接进入登录流程。
    打印日志(
      '登录检测',
      '登录状态',
      强制人工登录 ? '本地登录凭证疑似已失效，强制进入人工登录流程' : '未发现有效京东登录凭证，立即进入重新登录流程',
    );
    if (!允许人工登录) {
      throw new Error('登录态失效，本地京东登录凭证已缺失或过期。');
    }
    await page.goto(构建京东登录页地址(目标地址), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
  }

  const 当前地址 = page.url();
  const 页面文本 = await 读取页面文本(page);

  if (是无权限页面(页面文本)) {
    throw new Error('当前京东账号没有该页面权限，请确认账号后再运行。');
  }

  if (!是登录页面(当前地址, 页面文本) && 是目标业务页面(当前地址, 目标地址)) {
    打印日志('登录检测', '登录状态', '登录态有效');
    return;
  }

  if (!允许人工登录) {
    throw new Error('登录态失效，请先在后台里对该店铺执行一次可见登录。');
  }

  打印日志('登录检测', '登录状态', '需要人工登录，请在打开的浏览器里完成操作');
  await page.bringToFront().catch(() => {});
  const 已填充账号密码 = await 准备账号密码登录(page, 店铺配置, { 自动提交: 自动提交登录 });
  if (!已填充账号密码) {
    打印日志('登录检测', '登录状态', '当前页未命中可填充登录表单，准备重新打开目标页后再重试一次');
    await page.goto(目标地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.bringToFront().catch(() => {});
  }

  const 重试后已填充账号密码 = 已填充账号密码 || await 准备账号密码登录(page, 店铺配置, { 自动提交: 自动提交登录 });
  if (!重试后已填充账号密码) {
    打印日志('登录检测', '登录状态', '当前未找到可自动填充的账号密码表单，请手动完成登录');
  }
  await 等待业务页面就绪(page, { 目标地址 });
}

module.exports = {
  确保已登录,
  等待业务页面就绪,
  准备账号密码登录,
  是已登录但不在目标页面,
  是登录页面,
  是有效京东登录凭证Cookie,
  构建京东登录页地址,
};
