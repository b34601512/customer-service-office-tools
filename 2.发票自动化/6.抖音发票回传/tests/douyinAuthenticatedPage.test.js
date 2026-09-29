const test = require('node:test');
const assert = require('node:assert/strict');
const {
  是抖音业务页面,
  是抖音登录页面,
  是抖音官网首页,
  等待抖音登录完成,
} = require('../src/browser/douyinAuthenticatedPage');
const {
  读取抖音登录跳转地址,
  是同源抖音业务页面,
  是抖音目标或登录页面,
} = require('../src/browser/douyinBrowserContext');

test('抖音业务页和登录页按 URL 区分', () => {
  assert.equal(是抖音业务页面('https://fxg.jinritemai.com/ffa/mshop/homepage/index'), true);
  assert.equal(是抖音官网首页('https://fxg.jinritemai.com/'), true);
  assert.equal(是抖音业务页面('https://fxg.jinritemai.com/login/common?redirectUrl=x'), false);
  assert.equal(是抖音登录页面('https://fxg.jinritemai.com/login/common?redirectUrl=x'), true);
  assert.equal(是抖音登录页面('https://fxg.jinritemai.com/ffa/morder/receipt/list'), false);
});

test('持久化浏览器复用登录跳转后的同源业务页', () => {
  const loginUrl = 'https://fxg.jinritemai.com/';

  assert.equal(读取抖音登录跳转地址(loginUrl), '');
  assert.equal(是同源抖音业务页面('https://fxg.jinritemai.com/ffa/morder/receipt/list', loginUrl), true);
  assert.equal(是抖音目标或登录页面('https://fxg.jinritemai.com/ffa/morder/receipt/list', loginUrl), true);
  assert.equal(是抖音目标或登录页面('https://example.com/', loginUrl), false);
});

function 造抖音假页面(初始地址, 选项 = {}) {
  // 2026-09-29 假过期回归：只覆盖等待/重载/预填时点，不执行真实平台请求。
  const 状态 = { 地址: 初始地址, 空白: Boolean(选项.空白), 重载次数: 0, 正文: 选项.正文 || '' };
  return {
    状态,
    url: () => 状态.地址,
    async evaluate() {
      return 状态.空白
        ? { textLength: 0, maxRootHeight: 0, visibleControls: 0 }
        : { textLength: 120, maxRootHeight: 600, visibleControls: 5 };
    },
    async reload() {
      状态.重载次数 += 1;
      if (选项.重载后地址) 状态.地址 = 选项.重载后地址;
      if (选项.重载后正文) 状态.正文 = 选项.重载后正文;
      状态.空白 = Boolean(选项.重载后仍空白);
    },
    async waitForTimeout() {},
    async bringToFront() {},
    locator() {
      const 元素 = {
        async count() { return 1; },
        async isVisible() { return false; },
        async innerText() { return 状态.正文; },
        async fill() { throw new Error('测试假页面不得填写输入框'); },
        async evaluate() { return []; },
        async click() { throw new Error('测试假页面不得点击'); },
      };
      return {
        first: () => 元素,
        count: () => 元素.count(),
        innerText: (选项) => 元素.innerText(选项),
      };
    },
  };
}

test('抖音假过期：空白登录页只重载一次，恢复业务页后直接通过', async () => {
  const 页面 = 造抖音假页面('https://fxg.jinritemai.com/login/common', {
    空白: true,
    重载后地址: 'https://fxg.jinritemai.com/ffa/mshop/homepage/index',
    重载后正文: 'AI助手 订单管理',
  });
  const 结果 = await 等待抖音登录完成(页面, { id: 'd1', name: '抖音店铺1' }, {
    timeoutMs: 2000, intervalMs: 10, 登录页宽限毫秒: 0,
  });
  assert.equal(结果, true);
  assert.equal(页面.状态.重载次数, 1);
});

test('抖音假过期：持续空白也只重载一次，不无限刷新', async () => {
  const 页面 = 造抖音假页面('https://fxg.jinritemai.com/login/common', { 空白: true, 重载后仍空白: true });
  await assert.rejects(
    () => 等待抖音登录完成(页面, { id: 'd1', name: '抖音店铺1' }, {
      timeoutMs: 120, intervalMs: 10, 登录页宽限毫秒: 0,
    }),
    /等待抖音店铺「抖音店铺1」登录完成超时/,
  );
  assert.equal(页面.状态.重载次数, 1);
});

test('抖音登录页宽限期内不预填手机号（避免假过期误触发送验证码）', async () => {
  let 预填次数 = 0;
  const 页面 = 造抖音假页面('https://fxg.jinritemai.com/login/common');
  await assert.rejects(
    () => 等待抖音登录完成(页面, { id: 'd1', name: '抖音店铺1' }, {
      timeoutMs: 150, intervalMs: 10, 登录页宽限毫秒: 5000,
      依赖: { 准备抖音手机号登录: async () => { 预填次数 += 1; return { filled: true, message: '已预填' }; } },
    }),
    /登录完成超时/,
  );
  assert.equal(预填次数, 0);
});

test('抖音登录页超过宽限期只预填手机号，且明确禁止自动发验证码', async () => {
  const 调用选项 = [];
  const 页面 = 造抖音假页面('https://fxg.jinritemai.com/login/common');
  const 结果 = await 等待抖音登录完成(页面, { id: 'd1', name: '抖音店铺1' }, {
    timeoutMs: 2000, intervalMs: 10, 登录页宽限毫秒: 0,
    依赖: {
      准备抖音手机号登录: async (_当前页面, _店铺, 选项) => {
        调用选项.push(选项);
        页面.状态.地址 = 'https://fxg.jinritemai.com/ffa/mshop/homepage/index';
        页面.状态.正文 = 'AI助手 订单管理';
        return { filled: true, message: '已填入手机号' };
      },
    },
  });
  assert.equal(结果, true);
  assert.equal(调用选项.length, 1);
  assert.equal(调用选项[0].autoSendCode, false);
});
