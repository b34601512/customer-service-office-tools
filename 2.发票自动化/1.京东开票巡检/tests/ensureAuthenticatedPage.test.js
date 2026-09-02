const test = require('node:test');
const assert = require('node:assert/strict');

const {
  是已登录但不在目标页面,
  等待业务页面就绪,
  是有效京东登录凭证Cookie,
  构建京东登录页地址,
} = require('../src/browser/ensureAuthenticatedPage');

class FakePage {
  constructor(options = {}) {
    this.currentUrl = options.url || 'https://sz.jd.com/szweb/sz/view/index.html';
    this.currentText = options.text || '商智首页概览';
    this.gotoCalls = [];
    this.waitCount = 0;
    this.onWait = options.onWait || null;
  }

  locator(selector) {
    // 解决：给登录等待逻辑提供最小 body 文本能力，避免测试依赖真实浏览器。
    if (selector !== 'body') {
      throw new Error(`未实现的 selector：${selector}`);
    }

    return {
      innerText: async () => this.currentText,
    };
  }

  async waitForTimeout() {
    // 解决：测试里不需要真实等待，这里保持为同步空操作。
    this.waitCount += 1;
    if (this.onWait) {
      await this.onWait(this);
    }
  }

  url() {
    return this.currentUrl;
  }

  async goto(targetUrl) {
    // 解决：模拟登录后从首页跳转到目标页面的行为，验证系统会不会主动回跳。
    this.gotoCalls.push(targetUrl);
    this.currentUrl = targetUrl;
    this.currentText = '发票治理 页面内容';
  }

  async waitForLoadState() {
    // 解决：测试里不需要真实网络空闲，这里保持为同步空操作。
  }

  async bringToFront() {
    // 解决：测试里不需要真实前置窗口，这里保持为空操作。
  }
}

test('已登录但不在目标页面时应该返回 true', () => {
  assert.equal(
    是已登录但不在目标页面(
      'https://sz.jd.com/szweb/sz/view/index.html',
      '商智首页 经营概览 数据看板',
      'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html',
    ),
    true,
  );
});

test('登录页不应该误判成已登录中间页', () => {
  assert.equal(
    是已登录但不在目标页面(
      'https://passport.jd.com/uc/popupLogin2013',
      '扫码登录 账户登录',
      'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html',
    ),
    false,
  );
});

test('短信二次验证页不应该误判成已登录中间页', () => {
  assert.equal(
    是已登录但不在目标页面(
      'https://aq.jd.com/certified/index',
      '认证魔方 为确认是您本人操作 请使用手机短信验证码',
      'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html',
    ),
    false,
  );
});

test('只有未过期的京东认证Cookie才算有效登录凭证', () => {
  const 当前时间秒 = 2_000;
  assert.equal(是有效京东登录凭证Cookie({
    name: 'thor', domain: '.jd.com', expires: 3_000,
  }, 当前时间秒), true);
  assert.equal(是有效京东登录凭证Cookie({
    name: 'pin', domain: '.jd.com', expires: -1,
  }, 当前时间秒), true);
  assert.equal(是有效京东登录凭证Cookie({
    name: 'TrackID', domain: '.jd.com', expires: 3_000,
  }, 当前时间秒), false);
  assert.equal(是有效京东登录凭证Cookie({
    name: 'thor', domain: '.jd.com', expires: 1_000,
  }, 当前时间秒), false);
});

test('登录页地址应该携带巡检目标作为返回地址', () => {
  const 目标地址 = 'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html';
  const 登录地址 = 构建京东登录页地址(目标地址);
  assert.equal(new URL(登录地址).searchParams.get('ReturnUrl'), 目标地址);
});

test('京东新版开票治理地址不应该被误判成已登录中间页', () => {
  assert.equal(
    是已登录但不在目标页面(
      'https://jdsz.jd.com/szweb/view/service/create-invoice-governance-temp.html?sz=%2Fszweb%2Fsz%2Fview%2FserviceAnalysis%2FcreateInvoiceGovernance.html',
      '政企发票考核 警告：您有0笔订单剩余处理时间不足5天',
      'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html',
    ),
    false,
  );
});

test('登录成功后如果落在商智首页，系统应该自动跳回目标页面', async () => {
  const page = new FakePage({
    url: 'https://sz.jd.com/szweb/sz/view/index.html',
    text: '商智首页 经营概览 实时销售累计',
  });
  const 目标地址 = 'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html';

  await 等待业务页面就绪(page, {
    timeoutMs: 100,
    目标地址,
  });

  assert.deepEqual(page.gotoCalls, [目标地址]);
  assert.equal(page.url(), 目标地址);
});

test('登录成功后落在京东新版开票治理地址时应该直接放行', async () => {
  const 目标地址 = 'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html';
  const 新版地址 = 'https://jdsz.jd.com/szweb/view/service/create-invoice-governance-temp.html?sz=%2Fszweb%2Fsz%2Fview%2FserviceAnalysis%2FcreateInvoiceGovernance.html';
  const page = new FakePage({
    url: 新版地址,
    text: '政企发票考核 警告：您有0笔订单剩余处理时间不足5天 核心指标',
  });

  await 等待业务页面就绪(page, {
    timeoutMs: 100,
    目标地址,
  });

  assert.deepEqual(page.gotoCalls, []);
  assert.equal(page.url(), 新版地址);
});

test('短信二次验证完成后如果落在商智首页，系统应该等待人工完成后再跳回目标页面', async () => {
  const 目标地址 = 'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html';
  const page = new FakePage({
    url: 'https://aq.jd.com/certified/index',
    text: '认证魔方 为确认是您本人操作 请使用手机短信验证码',
    onWait: async (当前页面) => {
      // 解决：先模拟人工停留在二次验证页，再模拟验证完成后回到商智首页。
      if (当前页面.waitCount === 1) {
        return;
      }

      if (当前页面.waitCount === 2) {
        当前页面.currentUrl = 'https://sz.jd.com/szweb/sz/view/index.html';
        当前页面.currentText = '商智首页 经营概览 实时销售累计';
      }
    },
  });

  await 等待业务页面就绪(page, {
    timeoutMs: 100,
    目标地址,
  });

  assert.deepEqual(page.gotoCalls, [目标地址]);
  assert.equal(page.url(), 目标地址);
});
