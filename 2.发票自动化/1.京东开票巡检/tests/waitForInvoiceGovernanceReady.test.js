const test = require('node:test');
const assert = require('node:assert/strict');

const {
  是开票治理业务数据就绪,
  等待开票治理业务数据就绪,
} = require('../src/invoice/waitForInvoiceGovernanceReady');

class FakePage {
  constructor(options = {}) {
    this.currentText = options.text || '';
    this.currentUrl = options.url || '';
    this.currentTitle = options.title || '';
    this.readyState = options.readyState || '未知';
    this.waitCount = 0;
    this.onWait = options.onWait || null;
  }

  locator(selector) {
    // 解决：给业务数据等待逻辑提供最小 body 文本能力。
    if (selector !== 'body') {
      throw new Error(`未实现的 selector：${selector}`);
    }

    return {
      innerText: async () => this.currentText,
    };
  }

  async waitForTimeout() {
    // 解决：测试里不用真实等待，只推进模拟页面状态。
    this.waitCount += 1;
    if (this.onWait) {
      await this.onWait(this);
    }
  }

  url() {
    // 解决：给超时诊断提供页面地址。
    return this.currentUrl;
  }

  async title() {
    // 解决：给超时诊断提供页面标题。
    return this.currentTitle;
  }

  async evaluate() {
    // 解决：给超时诊断提供浏览器文档状态。
    return this.readyState;
  }
}

test('只有导航外壳时不应该认为开票治理业务数据已就绪', () => {
  assert.equal(
    是开票治理业务数据就绪('首页 交易 商品 政企发票考核 咨询 反馈'),
    false,
  );
});

test('出现核心指标和趋势分析时应该认为业务数据已就绪', () => {
  assert.equal(
    是开票治理业务数据就绪('政企发票考核 核心指标 发票及时上传率 趋势分析 明细数据重要提示 暂无数据'),
    true,
  );
});

test('等待开票治理业务数据就绪会等到异步内容出现', async () => {
  const page = new FakePage({
    text: '首页 交易 商品 政企发票考核 咨询 反馈',
    onWait: async (当前页面) => {
      if (当前页面.waitCount === 2) {
        当前页面.currentText = '政企发票考核 警告：您有0笔订单剩余处理时间不足5天 总共1条';
      }
    },
  });

  await 等待开票治理业务数据就绪(page, {
    timeoutMs: 50,
    intervalMs: 1,
  });

  assert.equal(page.waitCount, 2);
});

test('临时空态需要连续稳定后才算业务数据就绪', async () => {
  const page = new FakePage({
    text: '政企发票考核 明细数据重要提示 暂无数据',
  });

  await 等待开票治理业务数据就绪(page, {
    timeoutMs: 50,
    intervalMs: 1,
    空态稳定次数: 3,
  });

  assert.equal(page.waitCount, 2);
});

test('业务数据等待超时时应该带上页面诊断', async () => {
  const page = new FakePage({
    url: 'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html',
    title: '京东商智',
    readyState: 'complete',
    text: '',
  });

  await assert.rejects(
    () => 等待开票治理业务数据就绪(page, {
      timeoutMs: 10,
      intervalMs: 1,
      诊断日志间隔Ms: 60_000,
    }),
    /url=https:\/\/sz\.jd\.com\/szweb\/sz\/view\/serviceAnalysis\/createInvoiceGovernance\.html｜title=京东商智｜readyState=complete｜textLength=0/,
  );
});

test('目标页延迟跳转到登录页时应该立即报告登录态失效', async () => {
  const page = new FakePage({
    url: 'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html',
    title: '京东商智',
    readyState: 'complete',
    text: '首页 交易 商品 政企发票考核',
    onWait: async (当前页面) => {
      当前页面.currentUrl = 'https://passport.jd.com/new/login.aspx';
      当前页面.currentTitle = '京东-欢迎登录';
      当前页面.currentText = '扫码登录 密码登录 短信登录';
    },
  });

  await assert.rejects(
    () => 等待开票治理业务数据就绪(page, {
      timeoutMs: 50,
      intervalMs: 1,
    }),
    /登录态失效，页面已跳转到京东登录页/,
  );
});
