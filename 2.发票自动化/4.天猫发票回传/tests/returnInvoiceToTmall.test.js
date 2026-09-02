const test = require('node:test');
const assert = require('node:assert/strict');
const {
  是发票未找到错误,
  构建下载中心等待反馈,
  拼接财务参考到跳过原因,
  逐单下载天猫发票,
  上传已下载天猫发票,
} = require('../src/app/returnInvoiceToTmall');

test('识别下载中心未找到发票错误', () => {
  const error = new Error('诺诺发票系统没有找到可下载发票');
  assert.equal(是发票未找到错误(error), true);
});

test('下载中心等待反馈按 30 秒常见返回给出估计', () => {
  assert.equal(
    构建下载中心等待反馈(0, 2, 10),
    '下载中心正在处理第 1/2 张发票，已等待 10 秒。通常 30 秒内返回，预计还需约 20 秒。',
  );
  assert.equal(
    构建下载中心等待反馈(1, 2, 35),
    '下载中心正在处理第 2/2 张发票，已等待 35 秒。已超过常见 30 秒，仍在等待下载中心返回。',
  );
});

test('跳过原因会补充财务参考', () => {
  const message = 拼接财务参考到跳过原因(
    { financeIssueReference: '财务参考：已过 2 个工作日，常规约 7 个工作日' },
    '已跳过：下载中心没有找到可下载发票。',
  );

  assert.equal(message, '已跳过：下载中心没有找到可下载发票。｜财务参考：已过 2 个工作日，常规约 7 个工作日。');
});

test('逐单下载会跳过未开好发票并继续后续订单', async () => {
  const progress = [];
  const screenshotCalls = [];
  const orders = [
    { key: 'a:1001', storeId: 'a', storeName: '天猫A店', orderNumber: '1001' },
    { key: 'a:1002', storeId: 'a', storeName: '天猫A店', orderNumber: '1002' },
    { key: 'a:1003', storeId: 'a', storeName: '天猫A店', orderNumber: '1003' },
  ];
  const result = await 逐单下载天猫发票(orders, {
    page: {
      screenshot: async ({ path }) => {
        screenshotCalls.push(path);
      },
    },
    onProgress: (item) => progress.push(item),
    批量下载发票方法: async ({ orders: requestOrders }) => {
      const order = requestOrders[0];
      if (order.orderNumber === '1002') {
        const error = new Error('诺诺发票系统没有找到可下载发票，缺少 1 张：1002');
        error.code = 'INVOICE_NOT_FOUND_IN_NUONUO';
        throw error;
      }
      return [{
        ...order,
        invoiceFilePath: `D:\\invoice\\${order.orderNumber}.pdf`,
      }];
    },
  });

  assert.deepEqual(result.map((item) => item.orderNumber), ['1001', '1003']);
  const skippedProgress = progress.find((item) => item.status === 'skipped' && item.item.orderNumber === '1002');
  assert.ok(skippedProgress);
  assert.match(skippedProgress.item.screenshotPath, /skipped-/);
  assert.equal(screenshotCalls.length, 1);
});

test('逐单下载遇到单个订单异常会标记失败并继续', async () => {
  const progress = [];
  const screenshotCalls = [];
  const orders = [
    { key: 'a:1001', storeId: 'a', storeName: '天猫A店', orderNumber: '1001' },
    { key: 'a:1002', storeId: 'a', storeName: '天猫A店', orderNumber: '1002' },
    { key: 'a:1003', storeId: 'a', storeName: '天猫A店', orderNumber: '1003' },
  ];
  const result = await 逐单下载天猫发票(orders, {
    page: {
      screenshot: async ({ path }) => {
        screenshotCalls.push(path);
      },
    },
    onProgress: (item) => progress.push(item),
    批量下载发票方法: async ({ orders: requestOrders }) => {
      const order = requestOrders[0];
      if (order.orderNumber === '1002') {
        throw new Error('下载中心临时异常');
      }
      return [{ ...order, invoiceFilePath: `D:\\invoice\\${order.orderNumber}.pdf` }];
    },
  });

  assert.deepEqual(result.map((item) => item.orderNumber), ['1001', '1003']);
  const errorProgress = progress.find((item) => item.status === 'error' && item.item.orderNumber === '1002');
  assert.ok(errorProgress);
  assert.match(errorProgress.item.screenshotPath, /download-error-/);
  assert.equal(screenshotCalls.length, 1);
});

test('上传阶段每单开始前会重新获取可用天猫页面', async () => {
  const recoveredPage = { id: 'recovered-page' };
  const pageRequests = [];
  const uploads = await 上传已下载天猫发票({ id: 'stale-page' }, [
    { key: 'a:1001', storeId: 'a', storeName: '天猫A店', orderNumber: '1001', invoiceFilePath: 'D:\\invoice\\1001.pdf' },
    { key: 'a:1002', storeId: 'a', storeName: '天猫A店', orderNumber: '1002', invoiceFilePath: 'D:\\invoice\\1002.pdf' },
  ], {
    获取页面: async (options) => {
      pageRequests.push(options);
      return recoveredPage;
    },
    上传发票方法: async ({ page, order }) => {
      assert.equal(page, recoveredPage);
      return { invoiceNumber: `N-${order.orderNumber}`, targetType: '全电普通发票', screenshotPath: '' };
    },
  });

  assert.deepEqual(uploads.map((item) => item.orderNumber), ['1001', '1002']);
  assert.equal(pageRequests.length, 2);
  assert.equal(pageRequests.every((options) => options.当前页面), true);
});

test('上传失败后重置页面失败会恢复页面并继续下一单', async () => {
  const recoveredPage = { id: 'recovered-page' };
  const progress = [];
  let uploadCount = 0;
  let recoveryCount = 0;
  const uploads = await 上传已下载天猫发票({ id: 'stale-page' }, [
    { key: 'a:1001', storeId: 'a', storeName: '天猫A店', orderNumber: '1001', invoiceFilePath: 'D:\\invoice\\1001.pdf' },
    { key: 'a:1002', storeId: 'a', storeName: '天猫A店', orderNumber: '1002', invoiceFilePath: 'D:\\invoice\\1002.pdf' },
  ], {
    获取页面: async (options) => {
      if (options.强制重新打开) recoveryCount += 1;
      return recoveredPage;
    },
    上传发票方法: async () => {
      uploadCount += 1;
      if (uploadCount === 1) throw new Error('页面已关闭');
      return { invoiceNumber: 'N-1002', targetType: '全电普通发票', screenshotPath: '' };
    },
    重置列表方法: async () => {
      throw new Error('Target page, context or browser has been closed');
    },
    onProgress: (item) => progress.push(item),
  });

  assert.equal(uploads[0].status, 'error');
  assert.equal(uploads[1].status, 'success');
  assert.equal(recoveryCount, 1);
  assert.ok(progress.some((item) => item.status === 'error' && item.item.orderNumber === '1001'));
});

test('逐单下载等待期间会持续刷新动作反馈', async () => {
  const progress = [];
  const orders = [
    { key: 'a:1001', storeId: 'a', storeName: '天猫A店', orderNumber: '1001' },
  ];
  const result = await 逐单下载天猫发票(orders, {
    progressIntervalMs: 20,
    onProgress: (item) => progress.push(item),
    批量下载发票方法: async ({ orders: requestOrders }) => {
      await new Promise((resolve) => setTimeout(resolve, 75));
      const order = requestOrders[0];
      return [{ ...order, invoiceFilePath: `D:\\invoice\\${order.orderNumber}.pdf` }];
    },
  });
  const downloadingMessages = progress
    .filter((item) => item.status === 'downloading')
    .map((item) => item.message);

  assert.deepEqual(result.map((item) => item.orderNumber), ['1001']);
  assert.ok(downloadingMessages.length >= 2);
  assert.equal(downloadingMessages.every((message) => message.includes('已等待')), true);
  assert.equal(downloadingMessages.every((message) => message.includes('通常 30 秒内返回')), true);
});
