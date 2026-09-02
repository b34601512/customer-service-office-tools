const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  构建天猫浏览器启动参数,
  构建会话恢复路径列表,
  迁移浏览器会话恢复文件,
  获取或打开天猫页面,
  等待天猫页签稳定,
  是天猫目标或登录页面,
  读取天猫登录跳转地址,
} = require('../src/browser/tmallBrowserContext');
const { 天猫默认登录地址 } = require('../src/store/storeConfigService');

class FakePage {
  constructor(initialUrl = 'about:blank') {
    this.currentUrl = initialUrl;
    this.closed = false;
    this.gotoCalls = [];
    this.gotoOptions = [];
    this.broughtToFront = false;
  }

  isClosed() {
    // 该函数模拟 Playwright 页面关闭状态，验证历史页签会被清理。
    return this.closed;
  }

  url() {
    // 该函数模拟 Playwright 当前地址，验证已有天猫页会被优先复用。
    return this.currentUrl;
  }

  async close() {
    // 该函数记录页面关闭动作，避免测试依赖真实浏览器。
    this.closed = true;
  }

  async goto(url, options) {
    // 该函数记录导航目标，确认同一店铺不会被重复打开。
    this.currentUrl = url;
    this.gotoCalls.push(url);
    this.gotoOptions.push(options);
  }

  async bringToFront() {
    // 该函数记录前置动作，验证最终保留页签会被展示。
    this.broughtToFront = true;
  }
}

function 创建浏览器上下文桩(pages) {
  // 该函数模拟同一个持久化浏览器上下文里已经存在多个页签。
  return {
    pages() {
      return pages;
    },
    async newPage() {
      const page = new FakePage();
      pages.push(page);
      return page;
    },
  };
}

function 创建延迟恢复页签上下文桩(firstPage, restoredPage) {
  // 该函数模拟 Edge 启动后延迟恢复历史页签，验证轮询清理能覆盖异步双标签。
  let pagesCallCount = 0;
  return {
    pages() {
      pagesCallCount += 1;
      if (pagesCallCount >= 3 && !restoredPage.closed) {
        return [firstPage, restoredPage];
      }
      return [firstPage];
    },
    async newPage() {
      throw new Error('已有天猫页签时不应该新建页面');
    },
  };
}

function 创建临时浏览器资料目录() {
  // 该函数创建隔离测试目录，避免测试污染真实店铺浏览器资料。
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tmall-browser-profile-'));
}

test('天猫登录地址可以提取 redirect_url 业务入口', () => {
  const redirectUrl = 读取天猫登录跳转地址(天猫默认登录地址);

  assert.match(redirectUrl, /^https:\/\/myseller\.taobao\.com\//);
});

test('天猫页面身份识别登录页和登录后的业务页', () => {
  assert.equal(是天猫目标或登录页面(天猫默认登录地址, 天猫默认登录地址), true);
  assert.equal(是天猫目标或登录页面('https://loginmyseller.taobao.com/member/login.jhtml', 天猫默认登录地址), true);
  assert.equal(是天猫目标或登录页面('https://myseller.taobao.com/home.htm/QnworkbenchHome/', 天猫默认登录地址), true);
  assert.equal(是天猫目标或登录页面('https://myseller.taobao.com/home.htm/merchant-invoice/invoice/compensate', 'https://myseller.taobao.com/home.htm/QnworkbenchHome/'), true);
  assert.equal(是天猫目标或登录页面('https://example.com/', 天猫默认登录地址), false);
});

test('打开天猫页面前会关闭重复登录页签', async () => {
  const firstLoginPage = new FakePage(天猫默认登录地址);
  const secondLoginPage = new FakePage(天猫默认登录地址);
  const context = 创建浏览器上下文桩([firstLoginPage, secondLoginPage]);

  const page = await 获取或打开天猫页面(context, 天猫默认登录地址);

  assert.equal(page, firstLoginPage);
  assert.equal(firstLoginPage.closed, false);
  assert.equal(secondLoginPage.closed, true);
  assert.deepEqual(firstLoginPage.gotoCalls, []);
  assert.equal(firstLoginPage.broughtToFront, true);
});

test('没有可复用天猫页签时会使用现有页签导航且不新开第二个页签', async () => {
  const blankPage = new FakePage('about:blank');
  const context = 创建浏览器上下文桩([blankPage]);

  const page = await 获取或打开天猫页面(context, 天猫默认登录地址);

  assert.equal(context.pages().length, 1);
  assert.equal(page, blankPage);
  assert.deepEqual(blankPage.gotoCalls, [天猫默认登录地址]);
  assert.equal(blankPage.gotoOptions[0].waitUntil, 'domcontentloaded');
});

test('天猫浏览器启动参数禁止恢复历史页签', () => {
  const args = 构建天猫浏览器启动参数();

  assert.equal(args.includes('--new-window'), true);
  assert.equal(args.includes('--hide-crash-restore-bubble'), true);
  assert.equal(args.includes('--disable-session-crashed-bubble'), true);
});

test('会话恢复清理只迁移恢复标签文件且保留登录态目录', () => {
  const profileDir = 创建临时浏览器资料目录();
  const sessionDir = path.join(profileDir, 'Default', 'Sessions');
  const sessionStorageDir = path.join(profileDir, 'Default', 'Session Storage');
  const backupRoot = path.join(profileDir, 'backup');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(sessionStorageDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'Tabs_000001'), 'old-tab', 'utf8');
  fs.writeFileSync(path.join(sessionStorageDir, 'LOG'), 'keep-login-state', 'utf8');

  const cleanTargets = 构建会话恢复路径列表(profileDir);
  const migratedItems = 迁移浏览器会话恢复文件(profileDir, {
    now: new Date('2026-07-03T12:00:00+08:00'),
    projectRoot: profileDir,
    备份根目录: backupRoot,
  });

  assert.equal(cleanTargets.includes(sessionDir), true);
  assert.equal(cleanTargets.includes(sessionStorageDir), false);
  assert.equal(fs.existsSync(sessionDir), false);
  assert.equal(fs.existsSync(sessionStorageDir), true);
  assert.equal(migratedItems.length, 1);
  assert.equal(fs.existsSync(path.join(migratedItems[0].备份路径, 'Tabs_000001')), true);
});

test('天猫页签稳定等待会处理启动后延迟恢复的重复页签', async () => {
  const firstLoginPage = new FakePage(天猫默认登录地址);
  const restoredLoginPage = new FakePage(天猫默认登录地址);
  const context = 创建延迟恢复页签上下文桩(firstLoginPage, restoredLoginPage);

  const page = await 等待天猫页签稳定(context, 天猫默认登录地址, {
    最大等待毫秒: 1200,
    轮询间隔毫秒: 20,
  });

  assert.equal(page, firstLoginPage);
  assert.equal(firstLoginPage.closed, false);
  assert.equal(restoredLoginPage.closed, true);
});
