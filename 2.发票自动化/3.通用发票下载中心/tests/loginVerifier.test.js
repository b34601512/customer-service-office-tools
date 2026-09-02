const test = require('node:test');
const assert = require('node:assert/strict');
const {
  等待页面进入登录判定状态,
  判断是否已进入工作台,
  验证诺诺发票会话,
} = require('../src/nuonuo/loginVerifier');
const { 诺诺开票记录页地址 } = require('../src/nuonuo/invoiceApiDownloader');

function 创建模拟页面({ afterGotoUrl = 诺诺开票记录页地址 } = {}) {
  // 该函数用最小页面替身验证登录检查逻辑，不启动真实浏览器。
  const calls = [];
  let currentUrl = 'https://work.nuonuo.com/index';
  return {
    calls,
    page: {
      goto: async (url) => {
        calls.push(['goto', url]);
        currentUrl = afterGotoUrl;
      },
      waitForLoadState: async (state) => {
        calls.push(['waitForLoadState', state]);
      },
      url: () => currentUrl,
    },
  };
}

test('工作台 URL 不是登录页才算进入工作台', () => {
  assert.equal(判断是否已进入工作台('https://work.nuonuo.com/index'), true);
  assert.equal(判断是否已进入工作台('https://work.nuonuo.com/usercenter/allow/login'), false);
  assert.equal(判断是否已进入工作台('https://u.nuonuo.com/login'), false);
});

test('登录判定会等待密码框出现，避免加载中误判', async () => {
  let visibleCheckCount = 0;
  const page = {
    url: () => 'https://u.nuonuo.com/login',
    locator: () => ({
      first: () => ({
        isVisible: async () => {
          visibleCheckCount += 1;
          return visibleCheckCount >= 3;
        },
      }),
    }),
    waitForTimeout: async () => {},
  };
  const result = await 等待页面进入登录判定状态(page, 2000);
  assert.equal(result, 'login-form');
  assert.equal(visibleCheckCount, 3);
});

test('登录检查会进入开票记录页并读取主体列表', async () => {
  const { page, calls } = 创建模拟页面();
  const result = await 验证诺诺发票会话(page, {
    queryCompanyList: async () => ({
      companies: [{ id: '1', name: '测试主体' }],
    }),
  });
  assert.equal(calls[0][0], 'goto');
  assert.equal(calls[0][1], 诺诺开票记录页地址);
  assert.equal(result.companies.length, 1);
});

test('开票记录页跳回登录页时判定登录态失效', async () => {
  const { page } = 创建模拟页面({
    afterGotoUrl: 'https://work.nuonuo.com/usercenter/allow/login',
  });
  await assert.rejects(
    () => 验证诺诺发票会话(page, {
      queryCompanyList: async () => ({
        companies: [{ id: '1', name: '测试主体' }],
      }),
    }),
    /登录态已失效/,
  );
});

test('无头探测：已保存登录态有效时返回可回传主休数，不弹浏览器', async () => {
  const 调用记录 = [];
  const { 无头探测诺诺登录 } = require('../src/nuonuo/loginVerifier');
  const { page, calls } = 创建模拟页面();
  const result = await 无头探测诺诺登录(
    { username: 'tester', password: 'secret' },
    {
      createSession: async () => {
        调用记录.push('create');
        return { page, context: {}, browser: {} };
      },
      closeSession: async () => {
        调用记录.push('close');
      },
      verify: async () => ({ companies: [{ id: '1', name: '测试主体' }] }),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.invoiceSubjectCount, 1);
  assert.deepEqual(调用记录, ['create', 'close']);
});

test('无头探测：登录态失效时返回失败且不抛异常', async () => {
  const { 无头探测诺诺登录 } = require('../src/nuonuo/loginVerifier');
  const { page } = 创建模拟页面({
    afterGotoUrl: 'https://work.nuonuo.com/usercenter/allow/login',
  });
  const result = await 无头探测诺诺登录(
    { username: 'tester', password: 'secret' },
    {
      createSession: async () => ({ page, context: {}, browser: {} }),
      closeSession: async () => {},
      verify: async () => {
        throw new Error('诺诺登录态已失效，请先完成网页登录。');
      },
    },
  );
  assert.equal(result.ok, false);
  assert.match(String(result.message || ''), /登录态已失效/);
});

test('无头探测：账号密码未配置时不启动浏览器直接失败', async () => {
  const { 无头探测诺诺登录 } = require('../src/nuonuo/loginVerifier');
  let 启动次数 = 0;
  const result = await 无头探测诺诺登录({}, {
    createSession: async () => {
      启动次数 += 1;
      return { page: {}, context: {}, browser: {} };
    },
    closeSession: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(启动次数, 0);
});

test('主体接口不可用时不能保存为登录通过', async () => {
  const { page } = 创建模拟页面();
  await assert.rejects(
    () => 验证诺诺发票会话(page, {
      queryCompanyList: async () => ({ companies: [] }),
    }),
    /没有可用开票主体/,
  );
});
