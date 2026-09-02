const test = require('node:test');
const assert = require('node:assert/strict');

const {
  创建网络响应记录器,
  是响应体已不可读错误,
  是开票业务响应地址,
} = require('../src/invoice/networkRecorder');

class FakePage {
  constructor() {
    this.responseHandlers = new Set();
  }

  on(eventName, handler) {
    // 解决：模拟 Playwright response 监听，测试可以等待异步处理完成。
    if (eventName === 'response') {
      this.responseHandlers.add(handler);
    }
  }

  off(eventName, handler) {
    // 解决：验证停止监听时能移除采集函数。
    if (eventName === 'response') {
      this.responseHandlers.delete(handler);
    }
  }

  async emitResponse(response) {
    // 解决：逐个等待响应处理器，避免异步采集测试不稳定。
    await Promise.all([...this.responseHandlers].map((handler) => handler(response)));
  }
}

function createResponse({ url, contentType = 'application/json', data = {} }) {
  // 解决：快速构造最小响应对象，测试只关注 URL 过滤和 JSON 读取。
  let jsonReadCount = 0;
  return {
    url: () => url,
    status: () => 200,
    headers: () => ({ 'content-type': contentType }),
    json: async () => {
      jsonReadCount += 1;
      return data;
    },
    get jsonReadCount() {
      return jsonReadCount;
    },
  };
}

test('已知的 DevTools 响应体缺失错误应该被识别为噪声', () => {
  const 错误 = new Error('response.json: Protocol error (Network.getResponseBody): No resource with given identifier found');
  assert.equal(是响应体已不可读错误(错误), true);
});

test('普通 JSON 解析错误不应该被误判成噪声', () => {
  const 错误 = new Error('Unexpected token < in JSON at position 0');
  assert.equal(是响应体已不可读错误(错误), false);
});

test('无关 JSON 响应不会触发读取响应体', async () => {
  const page = new FakePage();
  const recorder = 创建网络响应记录器(page);
  const response = createResponse({
    url: 'https://example.com/analytics/config.json',
    data: { ok: true },
  });

  await page.emitResponse(response);

  assert.equal(response.jsonReadCount, 0);
  assert.deepEqual(recorder.获取记录(), []);
  recorder.停止();
  assert.equal(page.responseHandlers.size, 0);
});

test('开票治理相关 JSON 响应会被记录', async () => {
  const page = new FakePage();
  const recorder = 创建网络响应记录器(page);
  const response = createResponse({
    url: 'https://sz.jd.com/szweb/serviceAnalysis/createInvoiceGovernance/list',
    data: { rows: [{ id: 1 }] },
  });

  await page.emitResponse(response);

  assert.equal(response.jsonReadCount, 1);
  assert.equal(recorder.获取记录().length, 1);
  assert.equal(是开票业务响应地址(response.url()), true);
  recorder.停止();
});
