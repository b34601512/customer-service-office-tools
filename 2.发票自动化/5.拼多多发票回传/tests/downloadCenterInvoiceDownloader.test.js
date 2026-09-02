const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  下载中心默认地址,
  规范化下载中心订单列表,
  合并下载结果与订单,
  批量从下载中心下载发票,
} = require('../src/invoiceReturn/downloadCenterInvoiceDownloader');

function 启动下载中心假服务(handler) {
  // 该函数启动测试用 HTTP 服务，验证拼多多项目和下载中心之间的契约。
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

function 读取请求体(request) {
  // 该函数读取测试请求体，确认下载中心收到的是订单清单而不是上传细节。
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body ? JSON.parse(body) : {}));
    request.on('error', reject);
  });
}

function 关闭服务(server) {
  // 该函数确保测试结束后释放随机端口。
  return new Promise((resolve) => server.close(resolve));
}

test('下载中心默认地址使用公共服务端口', () => {
  assert.equal(下载中心默认地址, 'http://127.0.0.1:39410');
});

test('拼多多订单传给下载中心时只保留订单身份', () => {
  const orders = 规范化下载中心订单列表([
    {
      key: 'store-a:1001',
      店铺配置: { id: 'store-a', name: '拼多多A店' },
      orderNumber: ' 1001 ',
      invoiceFilePath: 'D:\\old\\1001.pdf',
    },
  ]);

  assert.deepEqual(orders, [{
    key: 'store-a:1001',
    platform: 'pdd',
    storeId: 'store-a',
    storeName: '拼多多A店',
    orderNumber: '1001',
  }]);
});

test('下载结果按订单号补回拼多多订单 key 和发票号码', () => {
  const result = 合并下载结果与订单(
    [{ key: 'store-a:1001', orderNumber: '1001' }],
    [{ orderNumber: '1001', invoiceFilePath: 'D:\\invoice\\1001.pdf', invoiceNumber: '26952000002820665311' }],
  );

  assert.equal(result[0].key, 'store-a:1001');
  assert.equal(result[0].invoiceFilePath, 'D:\\invoice\\1001.pdf');
  assert.equal(result[0].invoiceNumber, '26952000002820665311');
});

test('批量下载通过下载中心 HTTP 接口获取发票路径', async () => {
  const receivedRequests = [];
  const { server, baseUrl } = await 启动下载中心假服务(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true, service: '通用发票下载中心' }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/invoices/download') {
      const body = await 读取请求体(request);
      receivedRequests.push(body);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        ok: true,
        files: body.orders.map((order) => ({
          orderNumber: order.orderNumber,
          invoiceFilePath: `D:\\invoice\\${order.orderNumber}.pdf`,
          invoiceNumber: '26952000002820665311',
        })),
      }));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: false, message: 'not found' }));
  });

  try {
    const result = await 批量从下载中心下载发票({
      baseUrl,
      autoStart: false,
      orders: [{
        key: 'store-a:1001',
        storeId: 'store-a',
        storeName: '拼多多A店',
        orderNumber: '1001',
      }],
    });

    assert.equal(receivedRequests.length, 1);
    assert.deepEqual(receivedRequests[0].orders, [{
      key: 'store-a:1001',
      platform: 'pdd',
      storeId: 'store-a',
      storeName: '拼多多A店',
      orderNumber: '1001',
    }]);
    assert.equal(result[0].key, 'store-a:1001');
    assert.equal(result[0].invoiceFilePath, 'D:\\invoice\\1001.pdf');
    assert.equal(result[0].invoiceNumber, '26952000002820665311');
  } finally {
    await 关闭服务(server);
  }
});
