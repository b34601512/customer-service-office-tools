const test = require('node:test');
const assert = require('node:assert/strict');
const {
  接口每页条数,
  默认接口分页并发数,
  解析接口响应,
  复制可复用请求头,
  构建接口分页进度,
  构建分页请求体,
  分批读取接口页列表,
  读取全部发票申请单,
} = require('../src/consumerInvoice/invoiceApiReader');

test('接口响应非成功时直接报错', () => {
  assert.throws(
    () => 解析接口响应(JSON.stringify({ code: 312, msg: '请求异常' }), '测试接口'),
    /code=312/,
  );
});

test('分页请求体默认每页 10 并支持按配置写入申请时间', () => {
  const payload = 构建分页请求体({
    request: {
      pageIndex: 1,
      pageSize: 50,
      orderId: '旧订单',
    },
    accessContext: { source: 'web' },
  }, 3, {
    startDate: '2026-06-01',
    endDate: '2026-06-26',
  });

  const configuredPayload = 构建分页请求体({
    request: {
      pageIndex: 1,
      pageSize: 50,
      orderId: '旧订单',
    },
    accessContext: { source: 'web' },
  }, 4, {
    startDate: '2026-06-01',
    endDate: '2026-06-26',
  }, 20);

  assert.equal(接口每页条数, 10);
  assert.equal(payload.request.pageIndex, 3);
  assert.equal(payload.request.pageSize, 10);
  assert.equal(payload.request.orderId, null);
  assert.equal(payload.request.applyTimeStart, '2026-06-01 00:00:00');
  assert.equal(payload.request.applyTimeEnd, '2026-06-26 23:59:59');
  assert.deepEqual(payload.accessContext, { source: 'web' });
  assert.equal(configuredPayload.request.pageIndex, 4);
  assert.equal(configuredPayload.request.pageSize, 20);
});

test('复用请求头会保留 h5st 并排除浏览器禁止头', () => {
  const headers = 复制可复用请求头({
    h5st: 'signed',
    cookie: 'secret',
    host: 'sff.jd.com',
    'content-type': 'application/json;charset=UTF-8',
    'dsm-trace-id': 'trace',
  });

  assert.equal(headers.h5st, 'signed');
  assert.equal(headers.cookie, undefined);
  assert.equal(headers.host, undefined);
  assert.equal(headers['content-type'], 'application/json;charset=UTF-8');
});

test('剩余分页会按小批次读取，避免一次性全部并发', async () => {
  let 当前并发数 = 0;
  let 最大并发数 = 0;
  const result = await 分批读取接口页列表([2, 3, 4, 5, 6], 2, async (pageNumber) => {
    当前并发数 += 1;
    最大并发数 = Math.max(最大并发数, 当前并发数);
    await new Promise((resolve) => setTimeout(resolve, 5));
    当前并发数 -= 1;
    return pageNumber;
  });

  assert.equal(默认接口分页并发数, 3);
  assert.deepEqual(result, [2, 3, 4, 5, 6]);
  assert.equal(最大并发数, 2);
});

test('分页读取会持续回调文本进度条', async () => {
  const progressList = [];
  const requestPayloads = [];
  const page = {
    evaluate: async (fn, args) => {
      const payload = JSON.parse(args.body);
      requestPayloads.push(payload.request);
      return JSON.stringify({
        code: 200,
        data: {
          pageSize: payload.request.pageSize,
          totalCount: 40,
          data: [{ orderId: payload.request.pageIndex, ckFlag: false }],
        },
      });
    },
  };
  const capture = {
    url: 'https://sff.jd.com/api',
    headers: { h5st: 'signed' },
    postData: JSON.stringify({
      request: { pageIndex: 1, pageSize: 10 },
      accessContext: { source: 'web' },
    }),
    responseText: JSON.stringify({
      code: 200,
      data: { pageSize: 10, totalCount: 40, data: [] },
    }),
  };

  const result = await 读取全部发票申请单(page, capture, {
    startDate: '2026-06-01',
    endDate: '2026-06-26',
  }, {
    pageSize: 10,
    concurrentPageCount: 2,
    onProgress: (progress) => progressList.push(progress),
  });

  assert.deepEqual(requestPayloads.map((payload) => payload.pageIndex), [1, 2, 3, 4]);
  assert.deepEqual(progressList.map((progress) => progress.finishedPageCount), [1, 3, 4]);
  assert.equal(progressList.at(-1).percent, 100);
  assert.match(progressList[0].message, /^\[[#-]+\] 1\/4页 25%$/);
  assert.equal(result.metrics.concurrentPageCount, 2);
});

test('接口分页进度会生成稳定文本进度条', () => {
  const progress = 构建接口分页进度({
    已完成页数: 38,
    总页数: 75,
    totalCount: 748,
    pageSize: 10,
    concurrentPageCount: 3,
  });

  assert.equal(progress.percent, 50);
  assert.equal(progress.finishedPageCount, 38);
  assert.equal(progress.totalPageCount, 75);
  assert.match(progress.progressBar, /^\[[#-]{20}\]$/);
});
