const fs = require('fs');
const { chromium } = require('playwright');
const { 登录态文件路径 } = require('../common/paths');
const {
  登记项目进程,
  取消登记项目进程,
  构建浏览器归属启动参数,
} = require('../common/processRegistry');

const 诺诺浏览器默认启动参数 = ['--window-size=1440,960'];
let 当前共享诺诺浏览器会话 = null;
let 正在创建共享诺诺浏览器会话 = null;

function 会话仍可用(session) {
  if (!session?.page || session.page.isClosed?.()) return false;
  if (typeof session.browser?.isConnected === 'function' && !session.browser.isConnected()) return false;
  return true;
}

function 获取当前共享诺诺浏览器会话() {
  if (!会话仍可用(当前共享诺诺浏览器会话)) {
    当前共享诺诺浏览器会话 = null;
  }
  return 当前共享诺诺浏览器会话;
}

function 设置当前共享诺诺浏览器会话(session) {
  当前共享诺诺浏览器会话 = session || null;
  return 当前共享诺诺浏览器会话;
}

function 清除当前共享诺诺浏览器会话(session = null) {
  if (!session || 当前共享诺诺浏览器会话 === session
    || (session.browser && 当前共享诺诺浏览器会话?.browser === session.browser)
    || (session.context && 当前共享诺诺浏览器会话?.context === session.context)) {
    当前共享诺诺浏览器会话 = null;
  }
}

function 构建诺诺浏览器上下文选项({
  useSavedAuthState = true,
  acceptDownloads = false,
  authStateFilePath = 登录态文件路径,
  fileExists = fs.existsSync,
} = {}) {
  // 这个函数解决登录检查和发票下载必须使用同一份登录态文件的问题。
  const 浏览器上下文选项 = {
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
  };
  if (acceptDownloads) 浏览器上下文选项.acceptDownloads = true;
  if (useSavedAuthState && fileExists(authStateFilePath)) {
    浏览器上下文选项.storageState = authStateFilePath;
  }
  return 浏览器上下文选项;
}

function 读取浏览器进程PID(浏览器实例) {
  // 这个函数解决不同 Playwright 版本下浏览器 PID 能取则取，取不到也不阻塞主流程。
  if (typeof 浏览器实例?.process !== 'function') return 0;
  return Number(浏览器实例.process()?.pid || 0);
}

function 登记诺诺浏览器进程(浏览器实例) {
  // 这个函数解决异常退出后下次启动仍能识别本项目打开的浏览器。
  const 浏览器进程PID = 读取浏览器进程PID(浏览器实例);
  if (!浏览器进程PID) return;
  登记项目进程({ pid: 浏览器进程PID, role: 'nuonuo-browser', label: '诺诺浏览器会话' });
  浏览器实例.on?.('disconnected', () => 取消登记项目进程(浏览器进程PID));
}

async function 关闭诺诺浏览器会话({ browser = null, context = null } = {}) {
  // 这个函数解决所有诺诺浏览器会话退出时按同一顺序释放资源。
  await context?.close?.().catch(() => {});
  await browser?.close?.().catch(() => {});
  清除当前共享诺诺浏览器会话({ browser, context });
}

async function 创建或复用诺诺浏览器会话(options = {}) {
  const 已有会话 = 获取当前共享诺诺浏览器会话();
  if (已有会话) return 已有会话;
  if (正在创建共享诺诺浏览器会话) return 正在创建共享诺诺浏览器会话;
  正在创建共享诺诺浏览器会话 = 创建诺诺浏览器会话(options)
    .then((新会话) => {
      设置当前共享诺诺浏览器会话(新会话);
      return 新会话;
    })
    .finally(() => {
      正在创建共享诺诺浏览器会话 = null;
    });
  return 正在创建共享诺诺浏览器会话;
}

async function 关闭共享诺诺浏览器会话() {
  if (正在创建共享诺诺浏览器会话) {
    await 正在创建共享诺诺浏览器会话.catch(() => {});
  }
  const 会话 = 获取当前共享诺诺浏览器会话();
  if (!会话) return;
  清除当前共享诺诺浏览器会话(会话);
  await 关闭诺诺浏览器会话(会话);
}

async function 创建诺诺浏览器会话({
  headless = false,
  useSavedAuthState = true,
  acceptDownloads = false,
  launchBrowser = chromium.launch.bind(chromium),
  authStateFilePath = 登录态文件路径,
  fileExists = fs.existsSync,
} = {}) {
  // 这个函数解决登录检查和发票下载共用浏览器启动、登录态和异常清理规则。
  let 浏览器实例 = null;
  let 浏览器上下文 = null;
  try {
    浏览器实例 = await launchBrowser({
      channel: 'msedge',
      headless,
      args: [...诺诺浏览器默认启动参数, ...构建浏览器归属启动参数()],
    });
    登记诺诺浏览器进程(浏览器实例);
    浏览器上下文 = await 浏览器实例.newContext(构建诺诺浏览器上下文选项({
      useSavedAuthState,
      acceptDownloads,
      authStateFilePath,
      fileExists,
    }));
    const 页面实例 = await 浏览器上下文.newPage();
    return { browser: 浏览器实例, context: 浏览器上下文, page: 页面实例 };
  } catch (error) {
    await 关闭诺诺浏览器会话({ browser: 浏览器实例, context: 浏览器上下文 });
    throw error;
  }
}

module.exports = {
  构建诺诺浏览器上下文选项,
  会话仍可用,
  获取当前共享诺诺浏览器会话,
  设置当前共享诺诺浏览器会话,
  清除当前共享诺诺浏览器会话,
  关闭诺诺浏览器会话,
  创建诺诺浏览器会话,
  创建或复用诺诺浏览器会话,
  关闭共享诺诺浏览器会话,
};
