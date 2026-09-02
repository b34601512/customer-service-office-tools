const test = require('node:test');
const assert = require('node:assert/strict');
const { 打开目标页面 } = require('../src/browser/openTargetPage');
const { 目标页面地址, 是目标地址页面, 是目标地址或登录跳转页面 } = require('../src/browser/targetPageIdentity');

class FakePage {
  constructor(initialUrl = 'about:blank') {
    this.currentUrl = initialUrl;
    this.closed = false;
    this.gotoCalls = [];
    this.gotoOptions = [];
  }

  isClosed() {
    // 该函数模拟 Playwright 页面关闭状态，验证历史页签会被清理。
    return this.closed;
  }

  url() {
    // 该函数模拟 Playwright 当前地址，验证已有目标页会被优先复用。
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

  async waitForFunction() {
    // 该函数验证打开阶段不再等待正文，避免电脑卡时提前超时失败。
    throw new Error('打开阶段不应该等待页面正文。');
  }
}

function 创建浏览器上下文桩(pages) {
  // 该函数模拟同一个浏览器上下文里已经存在多个页签。
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

function 构建登录跳转地址(登录地址, 目标地址, 编码次数 = 1) {
  // 该函数模拟京东登录页 redirect_url，覆盖一层和两层编码两种真实跳转形式。
  let 跳转地址 = 目标地址;
  for (let index = 0; index < 编码次数; index += 1) {
    跳转地址 = encodeURIComponent(跳转地址);
  }
  return `${登录地址}?redirect_url=${跳转地址}`;
}

test('打开目标页面前会优先复用当前上下文已有目标页签', async () => {
  const targetUrl = 目标页面地址;
  const firstPage = new FakePage('about:blank');
  const restoredPage = new FakePage(targetUrl);
  const context = 创建浏览器上下文桩([firstPage, restoredPage]);

  const page = await 打开目标页面(context, targetUrl);

  assert.equal(page, restoredPage);
  assert.equal(firstPage.closed, true);
  assert.deepEqual(restoredPage.gotoCalls, []);
});

test('打开目标页面前会复用指向目标页的登录跳转页签', async () => {
  const targetUrl = 目标页面地址;
  const firstPage = new FakePage('about:blank');
  const loginRedirectPage = new FakePage(构建登录跳转地址('https://loginmyseller.jd.com/login', targetUrl));
  const context = 创建浏览器上下文桩([firstPage, loginRedirectPage]);

  const page = await 打开目标页面(context, targetUrl);

  assert.equal(page, loginRedirectPage);
  assert.equal(firstPage.closed, true);
  assert.deepEqual(loginRedirectPage.gotoCalls, []);
});

test('没有可复用页签时会新建唯一目标页签', async () => {
  const targetUrl = 目标页面地址;
  const pages = [];
  const context = 创建浏览器上下文桩(pages);

  const page = await 打开目标页面(context, targetUrl);

  assert.equal(pages.length, 1);
  assert.equal(page.closed, false);
  assert.deepEqual(page.gotoCalls, [targetUrl]);
  assert.equal(page.gotoOptions[0].waitUntil, 'domcontentloaded');
});

test('目标页面身份只认消费者发票路径，不被其它京东页面文案污染', () => {
  // 该用例验证错误业务页即使出现发票文案，也不会被当成目标页。
  assert.equal(是目标地址页面(目标页面地址), true);
  assert.equal(是目标地址页面('https://shop.jd.com/jdm/cz/index-ware?mainType=canJoinWare'), false);
});

test('目标页面身份会识别登录页里编码后的目标页跳转地址', () => {
  const 一层编码登录页 = 构建登录跳转地址('https://loginmyseller.jd.com/login', 目标页面地址);
  const 两层编码登录页 = 构建登录跳转地址('https://passport.jd.com/new/login.aspx', 目标页面地址, 2);
  const 京麦实际登录页 = `https://passport.shop.jd.com/login/index.action/jdm?ReturnUrl=${encodeURIComponent(目标页面地址)}`;
  const 无关登录页 = 构建登录跳转地址('https://passport.jd.com/new/login.aspx', 'https://shop.jd.com/jdm/cz/index-ware');

  assert.equal(是目标地址或登录跳转页面(目标页面地址), true);
  assert.equal(是目标地址或登录跳转页面(一层编码登录页), true);
  assert.equal(是目标地址或登录跳转页面(两层编码登录页), true);
  assert.equal(是目标地址或登录跳转页面(京麦实际登录页), true);
  assert.equal(是目标地址或登录跳转页面(无关登录页), false);
});
