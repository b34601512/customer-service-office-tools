const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const { 确保目录存在 } = require('../common/fs');
const { 打印日志 } = require('../common/logger');
const { 项目根目录 } = require('../common/paths');
const { 迁移到备份目录 } = require('../common/runtimeCleanup/pathMigration');
const { 获取店铺账号浏览器资料目录 } = require('./storeProfilePaths');
const { 抖音默认后台地址 } = require('./douyinBusinessUrl');

const 浏览器进程名列表 = ['msedge.exe', 'chrome.exe', 'chromium.exe'];
const 已打开浏览器上下文 = new Map();

function 上下文是否可用(context) {
  // 解决：复用已打开的持久化浏览器，避免同一资料目录重复启动导致锁冲突。
  if (!context) return false;
  try {
    if (typeof context.isClosed === 'function' && context.isClosed()) return false;
    context.pages();
    return true;
  } catch {
    return false;
  }
}

async function 关闭所有已打开抖音浏览器上下文() {
  // 解决：退出程序时统一关闭所有保持打开的核实窗口，平时不自动关闭。
  const 待关闭 = [...已打开浏览器上下文.values()];
  已打开浏览器上下文.clear();
  for (const ctx of 待关闭) {
    try {
      if (上下文是否可用(ctx)) await ctx.close();
    } catch {}
  }
}

function 获取已打开抖音浏览器上下文数量() {
  return 已打开浏览器上下文.size;
}

function 构建抖音浏览器启动参数() {
  // 解决：使用真实浏览器环境，同时禁止恢复崩溃页签造成重复标签。
  return [
    '--disable-blink-features=AutomationControlled',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--new-window',
  ];
}

function 获取店铺浏览器资料目录(店铺配置) {
  // 解决：店铺和账号共同决定资料目录，多店铺登录态物理隔离。
  return 获取店铺账号浏览器资料目录({
    storeId: 店铺配置.id,
    username: 店铺配置.username,
    browserName: 'msedge',
  });
}

function 转义PowerShell字符串(text) {
  // 解决：PowerShell 查询进程时要兼容中文路径和空格。
  return `'${String(text || '').replace(/'/g, "''")}'`;
}

function 查找资料目录浏览器进程(资料目录) {
  // 解决：只按本店铺资料目录查找浏览器，避免误关用户平时使用的 Edge。
  const 标准目录 = String(资料目录 || '').trim();
  if (!标准目录) return [];
  const 进程名条件 = 浏览器进程名列表
    .map((name) => `$_.Name -eq ${转义PowerShell字符串(name)}`)
    .join(' -or ');
  const script = `
$ErrorActionPreference = 'Stop'
$profileDir = ${转义PowerShell字符串(标准目录)}
Get-CimInstance Win32_Process |
  Where-Object {
    (${进程名条件}) -and
    $_.CommandLine -and
    $_.CommandLine -like "*$profileDir*"
  } |
  Select-Object ProcessId, Name, CommandLine |
  ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    cwd: 项目根目录,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`查询抖音店铺浏览器进程失败：${result.stderr.trim() || result.stdout.trim() || `退出码=${result.status}`}`);
  }
  const 输出文本 = String(result.stdout || '').trim();
  if (!输出文本) return [];
  const 解析结果 = JSON.parse(输出文本);
  return Array.isArray(解析结果) ? 解析结果 : [解析结果];
}

function 结束浏览器进程树(pid) {
  // 解决：用进程树结束本资料目录旧浏览器，避免残留标签继续抢同一个 profile。
  const 标准PID = Number(pid);
  if (!Number.isInteger(标准PID) || 标准PID <= 0) return false;
  const result = spawnSync('taskkill.exe', ['/PID', String(标准PID), '/T', '/F'], {
    cwd: 项目根目录,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status === 0) return true;
  const 输出文本 = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (/不存在|没有找到进程|找不到进程|not found|没有进程/i.test(输出文本)) return false;
  throw new Error(`结束抖音店铺浏览器失败：PID=${标准PID}，${输出文本.trim() || `退出码=${result.status}`}`);
}

function 清理残留店铺浏览器进程(资料目录) {
  // 解决：浏览器保持打开供人工核实后，程序不再自动关闭旧窗口；
  // 发现同资料目录仍有浏览器在运行（通常是上次核实未关闭的窗口）时明确提示手动关闭，避免误杀核实现场。
  const 进程列表 = 查找资料目录浏览器进程(资料目录);
  if (进程列表.length === 0) {
    return 0;
  }
  const PID列表 = 进程列表.map((进程) => 进程.ProcessId).join("、");
  throw new Error(
    `检测到「${资料目录}」的店铺浏览器仍在运行（PID=${PID列表}）：程序保持浏览器打开供你核实，不会自动关闭。` +
    `请先手动关闭该店铺的浏览器窗口后重试；若窗口已关闭仍提示，说明该店核实尚未完成，请核实后手动关窗。`
  );
}

function 构建会话恢复路径列表(资料目录) {
  // 解决：只清理恢复上次标签的文件，不动 Cookie 和 Local Storage 登录态。
  return [
    path.join(资料目录, 'Default', 'Sessions'),
    path.join(资料目录, 'Default', 'Last Session'),
    path.join(资料目录, 'Default', 'Last Tabs'),
    path.join(资料目录, 'Default', 'Current Session'),
    path.join(资料目录, 'Default', 'Current Tabs'),
    path.join(资料目录, 'Last Session'),
    path.join(资料目录, 'Last Tabs'),
  ];
}

function 迁移浏览器会话恢复文件(资料目录, 选项 = {}) {
  // 解决：启动前移走恢复标签文件，避免 Edge 把上次多个页签重新打开。
  const {
    now = new Date(),
    projectRoot = 项目根目录,
    备份根目录,
  } = 选项;
  const 迁移结果列表 = [];
  for (const 目标路径 of 构建会话恢复路径列表(资料目录)) {
    if (!fs.existsSync(目标路径)) continue;
    const 备份路径 = 迁移到备份目录(目标路径, { now, projectRoot, 备份根目录 });
    if (备份路径) 迁移结果列表.push({ 原路径: 目标路径, 备份路径 });
  }
  if (迁移结果列表.length > 0) {
    打印日志('抖音登录', '浏览器页签', `已迁移 ${迁移结果列表.length} 项会话恢复文件，防止重复页签`);
  }
  return 迁移结果列表;
}

function 准备抖音店铺浏览器资料目录(资料目录, 选项 = {}) {
  // 解决：打开浏览器前统一清理残留进程和恢复标签文件，保留登录态但不恢复旧标签。
  确保目录存在(资料目录);
  清理残留店铺浏览器进程(资料目录);
  迁移浏览器会话恢复文件(资料目录, 选项);
}

async function 创建抖音店铺浏览器上下文(店铺配置, 选项 = {}) {
  // 解决：使用持久化真实浏览器资料目录，同一资料目录在进程内复用已打开的浏览器，避免锁冲突；平时不自动关闭。
  const { headless = false } = 选项;
  const 资料目录 = 获取店铺浏览器资料目录(店铺配置);
  const 已有上下文 = 已打开浏览器上下文.get(资料目录);
  if (上下文是否可用(已有上下文)) {
    打印日志('抖音登录', '浏览器', `复用已打开店铺浏览器：${店铺配置.name} profile=${资料目录}`);
    return 已有上下文;
  }
  if (已有上下文) 已打开浏览器上下文.delete(资料目录);
  准备抖音店铺浏览器资料目录(资料目录, 选项);
  打印日志('抖音登录', '浏览器', `启动店铺浏览器：${店铺配置.name} profile=${资料目录}`);
  const context = await chromium.launchPersistentContext(资料目录, {
    channel: 'msedge',
    headless,
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
    args: 构建抖音浏览器启动参数(),
  });
  context.__douyinStoreProfilePath = 资料目录;
  context.setDefaultTimeout(10_000);
  已打开浏览器上下文.set(资料目录, context);
  const 清理缓存 = () => 已打开浏览器上下文.delete(资料目录);
  if (typeof context.once === 'function') context.once('close', 清理缓存);
  return context;
}

function 页面已关闭(page) {
  // 解决：兼容测试桩和真实 Playwright 页面，统一判断页面是否还能复用。
  return typeof page?.isClosed === 'function' && page.isClosed();
}

function 读取页面地址(page) {
  // 解决：页面地址读取统一兜住测试桩和 Playwright 页面方法差异。
  return page && typeof page.url === 'function' ? String(page.url() || '').trim() : '';
}

function 解析URL地址(url) {
  // 解决：第三方跳转 URL 可能为空或临时格式，解析失败时直接判为非目标页。
  try {
    return new URL(String(url || '').trim());
  } catch {
    return null;
  }
}

function 读取抖音登录跳转地址(url) {
  // 解决：抖音登录页真正后台入口藏在 redirectUrl 参数里。
  const parsed = 解析URL地址(url);
  return parsed?.searchParams.get('redirectUrl') || '';
}

function 是同源抖音业务页面(url, targetUrl = 抖音默认后台地址) {
  // 解决：已经登录后的 mms 页面应被复用，避免重新打开登录页造成重复标签。
  const parsed = 解析URL地址(url);
  const targetParsed = 解析URL地址(targetUrl);
  const redirectParsed = 解析URL地址(读取抖音登录跳转地址(targetUrl)) || targetParsed;
  if (!parsed || !redirectParsed || redirectParsed.hostname !== 'fxg.jinritemai.com') return false;
  return parsed.hostname === redirectParsed.hostname && !parsed.pathname.startsWith('/login');
}

function 是抖音登录页面(url) {
  // 解决：登录过程中已经在 login 页面时直接复用，不重复打开同一登录地址。
  const parsed = 解析URL地址(url);
  return parsed?.hostname === 'fxg.jinritemai.com' && parsed.pathname.startsWith('/login');
}

function 是抖音目标或登录页面(url, targetUrl = 抖音默认后台地址) {
  // 解决：优先复用目标页、登录页或登录后业务页，避免持久化浏览器恢复出两个同流程页签。
  const 当前地址 = String(url || '').trim();
  const 目标地址 = String(targetUrl || '').trim();
  return 当前地址 === 目标地址
    || 是抖音登录页面(当前地址)
    || 是同源抖音业务页面(当前地址, 目标地址);
}

async function 关闭多余抖音页面(页面列表, 保留页面) {
  // 解决：同一上下文可能残留多余页签，打开抖音前收敛成一个业务页签。
  const 多余页面列表 = 页面列表.filter((page) => page && page !== 保留页面 && !页面已关闭(page));
  for (const page of 多余页面列表) {
    await page.close({ runBeforeUnload: false });
  }
}

async function 获取唯一抖音页面(context, targetUrl) {
  // 解决：优先保留已有抖音目标页或登录页，关闭其它重复页签。
  const 页面列表 = context.pages().filter((page) => page && !页面已关闭(page));
  const page = 页面列表.find((候选页面) => 是抖音目标或登录页面(读取页面地址(候选页面), targetUrl))
    ?? 页面列表[0]
    ?? await context.newPage();
  await 关闭多余抖音页面(context.pages(), page);
  return page;
}

function 等待毫秒(ms) {
  // 解决：页签恢复是浏览器异步行为，短轮询等待状态稳定后再继续。
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function 等待抖音页签稳定(context, targetUrl, 选项 = {}) {
  // 解决：Edge 可能在启动后延迟恢复历史标签，必须反复收敛到只剩一个页签。
  const 最大等待毫秒 = Number(选项.最大等待毫秒 || 5000);
  const 轮询间隔毫秒 = Number(选项.轮询间隔毫秒 || 300);
  const deadline = Date.now() + 最大等待毫秒;
  let 连续稳定次数 = 0;
  let page = await 获取唯一抖音页面(context, targetUrl);
  while (Date.now() <= deadline) {
    page = await 获取唯一抖音页面(context, targetUrl);
    const 活动页面数 = context.pages().filter((item) => item && !页面已关闭(item)).length;
    if (活动页面数 <= 1) {
      连续稳定次数 += 1;
      if (连续稳定次数 >= 2) return page;
    } else {
      连续稳定次数 = 0;
    }
    await 等待毫秒(轮询间隔毫秒);
  }
  return page;
}

async function 获取或打开抖音页面(context, targetUrl) {
  // 解决：持久化浏览器恢复后先收敛为一个页签，再按需要导航到目标地址。
  let page = await 等待抖音页签稳定(context, targetUrl);
  if (!是抖音目标或登录页面(读取页面地址(page), targetUrl)) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  page = await 等待抖音页签稳定(context, targetUrl);
  await page.bringToFront().catch(() => {});
  return page;
}

module.exports = {
  构建抖音浏览器启动参数,
  获取店铺浏览器资料目录,
  转义PowerShell字符串,
  查找资料目录浏览器进程,
  结束浏览器进程树,
  清理残留店铺浏览器进程,
  构建会话恢复路径列表,
  迁移浏览器会话恢复文件,
  准备抖音店铺浏览器资料目录,
  创建抖音店铺浏览器上下文,
  关闭所有已打开抖音浏览器上下文,
  获取已打开抖音浏览器上下文数量,
  上下文是否可用,
  页面已关闭,
  读取页面地址,
  读取抖音登录跳转地址,
  是同源抖音业务页面,
  是抖音登录页面,
  是抖音目标或登录页面,
  关闭多余抖音页面,
  获取唯一抖音页面,
  等待抖音页签稳定,
  获取或打开抖音页面,
};
