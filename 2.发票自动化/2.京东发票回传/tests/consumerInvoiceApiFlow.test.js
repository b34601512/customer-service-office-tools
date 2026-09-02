const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const {
  查询全部申请单接口名,
  查询待开票申请单接口名,
  捕获查询全部申请单请求,
} = require('../src/consumerInvoice/signedInvoiceApiRequest');
const { 扫描消费者发票催促订单 } = require('../src/consumerInvoice/scanConsumerInvoiceUrges');
const { 目标页面地址 } = require('../src/browser/targetPageIdentity');

async function 打开模拟消费者发票页(page, html) {
  // 该函数用真实目标 URL 承载测试页面，避免扫描入口绕过页面身份校验。
  await page.route(目标页面地址, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    });
  });
  await page.goto(目标页面地址);
}

function 构建测试页面HTML() {
  // 该函数模拟京东消费者发票页面，只保留触发内部接口所需的顶部标签。
  return `
    <style>
      .invoice-tabs { display: flex; align-items: center; height: 36px; gap: 24px; }
      .invoice-tabs button { height: 30px; border: 0; background: white; }
    </style>
    <h1>消费者发票管理</h1>
    <div class="invoice-tabs">
      <button type="button" id="allInvoiceTab">全部</button>
      <button type="button" id="pendingInvoiceTab">近3个月待开票 (60)</button>
    </div>
    <script>
      document.querySelector('#allInvoiceTab').addEventListener('click', () => {
        fetch('https://sff.jd.com/api?v=1.0&appId=test&api=${查询全部申请单接口名}', {
          method: 'POST',
          headers: {
            'content-type': 'application/json;charset=UTF-8',
            'h5st': 'signed',
            'dsm-trace-id': 'trace',
            'x-requested-with': 'XMLHttpRequest'
          },
          body: JSON.stringify({
            request: {
              pageIndex: 1,
              pageSize: 10,
              orderId: null,
              applyTimeStart: null,
              applyTimeEnd: null
            },
            accessContext: { source: 'web' }
          })
        });
      });
    </script>
  `;
}

function 构建已停在全部标签HTML() {
  // 该函数模拟浏览器恢复到“全部”标签后，再点“全部”不会重新发请求的真实情况。
  return `
    <style>
      .invoice-tabs { display: flex; align-items: center; height: 36px; gap: 24px; }
      .invoice-tabs button { height: 30px; border: 0; background: white; }
    </style>
    <h1>消费者发票管理</h1>
    <div class="invoice-tabs">
      <button type="button" id="allInvoiceTab">全部</button>
      <button type="button" id="pendingInvoiceTab">近3个月待开票 (60)</button>
    </div>
    <script>
      window.activeTab = 'all';
      function requestApi(api, kind) {
        return fetch('https://sff.jd.com/api?v=1.0&appId=test&api=' + api, {
          method: 'POST',
          headers: {
            'content-type': 'application/json;charset=UTF-8',
            'h5st': 'signed',
            'dsm-trace-id': 'trace',
            'x-requested-with': 'XMLHttpRequest'
          },
          body: JSON.stringify({
            request: { pageIndex: 1, pageSize: 10, kind },
            accessContext: { source: 'web' }
          })
        });
      }
      document.querySelector('#allInvoiceTab').addEventListener('click', () => {
        if (window.activeTab === 'all') return;
        window.activeTab = 'all';
        requestApi('${查询全部申请单接口名}', 'all');
      });
      document.querySelector('#pendingInvoiceTab').addEventListener('click', () => {
        window.activeTab = 'pending';
        requestApi('${查询待开票申请单接口名}', 'pending');
      });
    </script>
  `;
}

function 构建接口订单列表(requestPayload) {
  // 该函数按请求页码返回测试订单，验证业务只认 ckFlag。
  const { pageIndex, pageSize } = requestPayload.request;
  if (pageSize === 10) {
    if (pageIndex === 1) {
      return [{
        orderId: 1000000000001,
        ckFlag: true,
        invoiceStatusName: '待开票',
      }];
    }
    return [{
      orderId: 1000000000002,
      ckFlag: false,
      invoiceStatusName: '开票成功',
    }];
  }
  if (pageIndex === 1) {
    return [
      {
        orderId: 1000000000001,
        ckFlag: true,
        applyTime: '2026-06-26 10:00:00',
        orderCompleteTime: '2026-06-25 10:00:00',
        invoiceStatusName: '待开票',
        invoiceAmount: 10,
      },
      {
        orderId: 1000000000002,
        ckFlag: false,
        invoiceStatusName: '待开票',
      },
    ];
  }
  return [{
    orderId: 1000000000003,
    ckFlag: false,
    invoiceStatusName: '开票成功',
  }];
}

async function 注册京东接口路由(page, requestPayloads, 选项 = {}) {
  // 该函数拦截京东接口请求，避免测试依赖真实网络和真实店铺。
  const totalCount = 选项.totalCount || 20;
  await page.route('https://sff.jd.com/api**', async (route) => {
    const request = route.request();
    const requestOrigin = request.headers().origin || 'null';
    const corsHeaders = {
      'access-control-allow-origin': requestOrigin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type,h5st,dsm-trace-id,x-requested-with',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
      return;
    }

    const payload = JSON.parse(request.postData() || '{}');
    requestPayloads.push(payload.request);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({
        code: 200,
        msg: '成功',
        data: {
          pageSize: payload.request.pageSize,
          totalCount,
          data: 构建接口订单列表(payload),
        },
      }),
    });
  });
}

function 等待毫秒(ms) {
  // 该函数让异步拒绝有机会触发，验证不会再出现未处理 Promise 拒绝。
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function 构建慢点击点假页面() {
  // 该函数模拟京东页面找点击点很慢、接口等待先超时的场景。
  let evaluateCount = 0;
  return {
    mouse: {
      click: async () => {},
    },
    evaluate: async () => {
      evaluateCount += 1;
      if (evaluateCount === 2) {
        await 等待毫秒(50);
        return { ok: true, x: 10, y: 10, text: '全部' };
      }
      if (evaluateCount === 4) {
        return { ok: true, x: 20, y: 10, text: '近3个月待开票 (60)' };
      }
      if (evaluateCount === 6) {
        return { ok: true, x: 10, y: 10, text: '全部' };
      }
      return undefined;
    },
    waitForResponse: () => new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('Timeout 10ms exceeded')), 10);
    }),
  };
}

test('扫描流程通过页面签名接口读取全部分页且只登记 ckFlag=true', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const requestPayloads = [];
  await 注册京东接口路由(page, requestPayloads);
  await 打开模拟消费者发票页(page, 构建测试页面HTML());

  const result = await 扫描消费者发票催促订单(page, {
    applicationDateRangeDays: 30,
    targetUrl: 目标页面地址,
    pageSize: 10,
  }, {
    当前时间: new Date('2026-06-26T12:00:00+08:00'),
  });

  await browser.close();

  assert.deepEqual(result.records.map((record) => record.orderNumber), ['1000000000001']);
  assert.equal(result.invoiceOrders.length, 2);
  assert.equal(result.metrics.scannedPageCount, 2);
  assert.equal(result.metrics.pageSize, 10);
  assert.equal(result.metrics.concurrentPageCount, 3);
  assert.equal(result.metrics.applicationDateRange.startDate, '2026-05-27');
  assert.deepEqual(requestPayloads.map((payload) => payload.pageSize), [10, 10, 10]);
  assert.deepEqual(requestPayloads.slice(1).map((payload) => payload.pageIndex), [1, 2]);
  assert.ok(requestPayloads.slice(1).every((payload) => payload.applyTimeStart === '2026-05-27 00:00:00'));
});

test('页面已停在全部标签时会先切待开票再切回全部捕获接口', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const requestPayloads = [];
  await 注册京东接口路由(page, requestPayloads);
  await page.setContent(构建已停在全部标签HTML());

  const captured = await 捕获查询全部申请单请求(page, {
    首次点击超时Ms: 100,
    timeoutMs: 5_000,
  });

  await browser.close();

  assert.match(captured.url, /queryAllApplyOrderList/);
  assert.deepEqual(requestPayloads.map((payload) => payload.kind), ['pending', 'all']);
});

test('接口等待超时早于点击点计算时不会产生未处理拒绝', async () => {
  const unhandledReasons = [];
  const onUnhandledRejection = (reason) => {
    unhandledReasons.push(reason);
  };

  process.on('unhandledRejection', onUnhandledRejection);
  try {
    await assert.rejects(
      () => 捕获查询全部申请单请求(构建慢点击点假页面(), {
        首次点击超时Ms: 10,
        timeoutMs: 10,
      }),
      /Timeout 10ms exceeded/
    );
    await 等待毫秒(30);
    assert.deepEqual(unhandledReasons, []);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
});
