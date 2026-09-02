const test = require('node:test');
const assert = require('node:assert/strict');
const {
  是发票未找到错误,
  构建回传报告订单,
  构建下载中心等待反馈,
  拼接财务参考到跳过原因,
  合并下载中心发票字段,
  逐单下载拼多多发票,
} = require('../src/app/returnInvoiceToPdd');

test('下载中心未找到发票错误会被识别为可跳过业务失败', () => {
  const error = new Error('诺诺发票系统没有找到可下载发票，缺少 1 张：260620-1');
  error.response = { code: 'INVOICE_NOT_FOUND_IN_NUONUO' };

  assert.equal(是发票未找到错误(error), true);
  assert.equal(是发票未找到错误(new Error('网络断开')), false);
});

test('回传报告订单会保留拼多多上传需要展示的关键字段', () => {
  const reportItem = 构建回传报告订单({
    key: 'pdd-store-1:260620-1',
    storeId: 'pdd-store-1',
    storeName: '拼多多店铺1',
    orderNumber: '260620-1',
    invoiceAmount: '362.18',
    invoiceType: '增值税电子普通发票',
    invoiceApplyTime: '2026-07-01 10:30:00',
    promisedInvoiceTime: '2026-07-10 23:59:59',
    financeIssueReference: '财务参考：已过 2 个工作日，常规约 7 个工作日',
    invoiceTitle: '个人',
    invoiceNumber: '26952000002820665311',
    invoiceFilePath: 'D:\\invoice\\260620-1.pdf',
  });

  assert.equal(reportItem.orderNumber, '260620-1');
  assert.equal(reportItem.invoiceApplyTime, '2026-07-01 10:30:00');
  assert.equal(reportItem.promisedInvoiceTime, '2026-07-10 23:59:59');
  assert.match(reportItem.financeIssueReference, /常规约 7 个工作日/);
  assert.equal(reportItem.invoiceNumber, '26952000002820665311');
  assert.equal(reportItem.invoiceFilePath, 'D:\\invoice\\260620-1.pdf');
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

test('下载结果合并时保留发票号码给拼多多回填', () => {
  const merged = 合并下载中心发票字段(
    { orderNumber: '260620-1', invoiceTitle: '个人' },
    {
      invoiceFilePath: 'D:\\invoice\\260620-1.pdf',
      invoiceNumber: '26952000002820665311',
      invoiceCode: '',
    },
  );

  assert.equal(merged.invoiceFilePath, 'D:\\invoice\\260620-1.pdf');
  assert.equal(merged.invoiceNumber, '26952000002820665311');
  assert.equal(merged.invoiceCode, '');
});

test('下载中心未找到发票时会保存拼多多跳过凭证截图', async () => {
  const progressList = [];
  const screenshotPaths = [];
  const orders = [
    { storeId: 'pdd-store-1', storeName: '拼多多店铺1', orderNumber: '260620-1' },
    {
      storeId: 'pdd-store-1',
      storeName: '拼多多店铺1',
      orderNumber: '260620-2',
      financeIssueReference: '财务参考：已过 2 个工作日，常规约 7 个工作日',
    },
  ];

  const downloads = await 逐单下载拼多多发票(orders, {
    page: {
      screenshot: async ({ path }) => {
        screenshotPaths.push(path);
      },
    },
    onProgress: (progress) => progressList.push(progress),
    批量下载发票方法: async ({ orders: currentOrders }) => {
      const order = currentOrders[0];
      if (order.orderNumber === '260620-2') {
        const error = new Error('诺诺发票系统没有找到可下载发票，缺少 1 张：260620-2');
        error.response = { code: 'INVOICE_NOT_FOUND_IN_NUONUO' };
        throw error;
      }
      return [{ invoiceFilePath: 'D:\\invoice\\260620-1.pdf', invoiceNumber: '26952000002820665311' }];
    },
  });

  const skippedProgress = progressList.find((progress) => progress.status === 'skipped');

  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].orderNumber, '260620-1');
  assert.equal(screenshotPaths.length, 1);
  assert.match(screenshotPaths[0], /pdd-invoice-return-pdd-store-1-260620-2-skipped-/);
  assert.match(skippedProgress.item.screenshotPath, /pdd-invoice-return-pdd-store-1-260620-2-skipped-/);
});

test('下载中心异常时会保存拼多多失败凭证截图', async () => {
  const progressList = [];
  const screenshotPaths = [];
  const orders = [
    { storeId: 'pdd-store-1', storeName: '拼多多店铺1', orderNumber: '260620-3' },
  ];

  const downloads = await 逐单下载拼多多发票(orders, {
    page: {
      screenshot: async ({ path }) => {
        screenshotPaths.push(path);
      },
    },
    onProgress: (progress) => progressList.push(progress),
    批量下载发票方法: async () => {
      throw new Error('下载中心临时异常');
    },
  });

  const errorProgress = progressList.find((progress) => progress.status === 'error');

  assert.equal(downloads.length, 0);
  assert.equal(screenshotPaths.length, 1);
  assert.match(screenshotPaths[0], /pdd-invoice-return-pdd-store-1-260620-3-download-error-/);
  assert.match(errorProgress.item.screenshotPath, /pdd-invoice-return-pdd-store-1-260620-3-download-error-/);
});
