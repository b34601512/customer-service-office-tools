const test = require('node:test');
const assert = require('node:assert/strict');
const { 校验回传输入, 执行发票回传, 执行批量发票回传 } = require('../src/app/returnInvoiceToJd');

test('发票回传输入只校验订单和京东店铺信息', () => {
  const result = 校验回传输入({
    order: { key: '京东1店:1000000000001', orderNumber: '1000000000001', workflowStatus: 'invoice_registered', invoiceStatusKind: 'pending' },
    store: { id: '京东1店', name: '京东1店' },
  });

  assert.equal(result.orderNumber, '1000000000001');
  assert.equal(result.店铺配置.id, '京东1店');
  assert.throws(
    () => 校验回传输入({
      order: { key: '', orderNumber: '' },
      store: { id: '京东1店', name: '京东1店' },
    }),
    /缺少订单号/,
  );
});

test('发票回传主流程先从下载中心取发票再上传京东并记录成功状态', async () => {
  const 调用顺序 = [];
  const result = await 执行发票回传({
    order: {
      key: '京东1店:1000000000001',
      storeId: '京东1店',
      storeName: '京东1店',
      orderNumber: '1000000000001',
      workflowStatus: 'invoice_registered',
      invoiceStatusKind: 'pending',
    },
    store: {
      id: '京东1店',
      name: '京东1店',
      targetUrl: 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder',
    },
    下载发票方法: async ({ orderNumber }) => {
      调用顺序.push(`download:${orderNumber}`);
      return 'D:\\invoice\\1000000000001.pdf';
    },
    回传发票到京东方法: async ({ orderNumber, invoiceFilePath }) => {
      调用顺序.push(`upload:${orderNumber}:${invoiceFilePath}`);
    },
    设置订单发票回传成功方法: (key, payload) => {
      调用顺序.push(`save:${key}:${payload.invoiceFilePath}`);
      return { key, invoiceReturned: true, invoiceReturnFilePath: payload.invoiceFilePath };
    },
  });

  assert.deepEqual(调用顺序, [
    'download:1000000000001',
    'upload:1000000000001:D:\\invoice\\1000000000001.pdf',
    'save:京东1店:1000000000001:D:\\invoice\\1000000000001.pdf',
  ]);
  assert.equal(result.order.invoiceReturned, true);
  assert.equal(result.invoiceFilePath, 'D:\\invoice\\1000000000001.pdf');
});

test('批量发票回传只处理京东后台待开票未回传订单并按先下载后上传执行', async () => {
  const 调用顺序 = [];
  const 进度记录 = [];
  const result = await 执行批量发票回传({
    orders: [
      {
        key: 'store-a:1000000000001',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000001',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
      {
        key: 'store-b:1000000000002',
        storeId: 'store-b',
        storeName: '京东B店',
        orderNumber: '1000000000002',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
      {
        key: 'store-a:1000000000003',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000003',
        workflowStatus: 'pending',
        invoiceStatusKind: 'success',
        invoiceReturned: false,
      },
    ],
    stores: [
      { id: 'store-a', name: '京东A店', targetUrl: 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder' },
      { id: 'store-b', name: '京东B店', targetUrl: 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder' },
    ],
    批量下载发票方法: async ({ orders, headless }) => {
      assert.equal(headless, true);
      调用顺序.push(`download:${orders.map((order) => order.orderNumber).join(',')}`);
      return orders.map((order) => ({
        key: order.key,
        orderNumber: order.orderNumber,
        invoiceFilePath: `D:\\invoice\\${order.orderNumber}.pdf`,
      }));
    },
    执行京东回传会话方法: async ({
      店铺配置,
      invoiceUploads,
      headless,
      允许人工登录,
      需要可见浏览器处理方法,
      onUploadStart,
      onUploaded,
    }) => {
      assert.equal(headless, true);
      assert.equal(允许人工登录, false);
      assert.equal(typeof 需要可见浏览器处理方法, 'function');
      调用顺序.push(`upload:${店铺配置.id}:${invoiceUploads.map((item) => item.orderNumber).join(',')}`);
      for (const item of invoiceUploads) {
        await onUploadStart(item);
        await onUploaded({ ...item, screenshotPath: `D:\\screenshots\\${item.orderNumber}.png` });
      }
    },
    设置订单发票回传成功方法: (key, payload) => {
      调用顺序.push(`save:${key}:${payload.invoiceFilePath}:${payload.screenshotPath}`);
    },
    onProgress: (progress) => 进度记录.push(progress),
  });

  assert.deepEqual(调用顺序, [
    'download:1000000000001',
    'download:1000000000002',
    'upload:store-a:1000000000001',
    'save:store-a:1000000000001:D:\\invoice\\1000000000001.pdf:D:\\screenshots\\1000000000001.png',
    'upload:store-b:1000000000002',
    'save:store-b:1000000000002:D:\\invoice\\1000000000002.pdf:D:\\screenshots\\1000000000002.png',
  ]);
  assert.deepEqual(
    进度记录.filter((progress) => progress.type === 'item').map((progress) => `${progress.status}:${progress.item.orderNumber}`),
    [
      'downloading:1000000000001',
      'downloaded:1000000000001',
      'downloading:1000000000002',
      'downloaded:1000000000002',
      'uploading:1000000000001',
      'success:1000000000001',
      'uploading:1000000000002',
      'success:1000000000002',
    ],
  );
  assert.equal(进度记录[0].type, 'init');
  assert.equal(进度记录.at(-1).type, 'finish');
  assert.equal(result.successCount, 2);
  assert.equal(result.totalCount, 2);
});

test('批量发票回传遇到未开好发票会跳过并继续后续订单', async () => {
  const 调用顺序 = [];
  const 进度记录 = [];
  const result = await 执行批量发票回传({
    orders: [
      {
        key: 'store-a:1000000000001',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000001',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
      {
        key: 'store-a:1000000000002',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000002',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
      {
        key: 'store-a:1000000000003',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000003',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
    ],
    stores: [
      { id: 'store-a', name: '京东A店', targetUrl: 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder' },
    ],
    批量下载发票方法: async ({ orders }) => {
      const order = orders[0];
      调用顺序.push(`download:${order.orderNumber}`);
      if (order.orderNumber === '1000000000002') {
        const error = new Error('诺诺发票系统没有找到可下载发票，缺少 1 张：1000000000002');
        error.response = { code: 'INVOICE_NOT_FOUND_IN_NUONUO' };
        throw error;
      }
      return [{
        key: order.key,
        orderNumber: order.orderNumber,
        invoiceFilePath: `D:\\invoice\\${order.orderNumber}.pdf`,
      }];
    },
    执行京东回传会话方法: async ({ 店铺配置, invoiceUploads, onUploadStart, onUploaded }) => {
      调用顺序.push(`upload:${店铺配置.id}:${invoiceUploads.map((item) => item.orderNumber).join(',')}`);
      for (const item of invoiceUploads) {
        await onUploadStart(item);
        await onUploaded({ ...item, screenshotPath: `D:\\screenshots\\${item.orderNumber}.png` });
      }
    },
    设置订单发票回传成功方法: (key, payload) => {
      调用顺序.push(`save:${key}:${payload.invoiceFilePath}:${payload.screenshotPath}`);
    },
    onProgress: (progress) => 进度记录.push(progress),
  });

  assert.deepEqual(调用顺序, [
    'download:1000000000001',
    'download:1000000000002',
    'download:1000000000003',
    'upload:store-a:1000000000001,1000000000003',
    'save:store-a:1000000000001:D:\\invoice\\1000000000001.pdf:D:\\screenshots\\1000000000001.png',
    'save:store-a:1000000000003:D:\\invoice\\1000000000003.pdf:D:\\screenshots\\1000000000003.png',
  ]);
  assert.deepEqual(
    进度记录.filter((progress) => progress.type === 'item').map((progress) => `${progress.status}:${progress.item.orderNumber}`),
    [
      'downloading:1000000000001',
      'downloaded:1000000000001',
      'downloading:1000000000002',
      'skipped:1000000000002',
      'downloading:1000000000003',
      'downloaded:1000000000003',
      'uploading:1000000000001',
      'success:1000000000001',
      'uploading:1000000000003',
      'success:1000000000003',
    ],
  );
  assert.equal(result.successCount, 2);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.totalCount, 3);
  assert.match(result.message, /跳过 1 单/);
});

test('全部发票未找到时仍为涉及店铺打开京东核对会话', async () => {
  const 会话记录 = [];
  const 进度记录 = [];
  const result = await 执行批量发票回传({
    orders: [
      {
        key: 'store-a:1000000000001',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000001',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
      {
        key: 'store-b:1000000000002',
        storeId: 'store-b',
        storeName: '京东B店',
        orderNumber: '1000000000002',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
    ],
    stores: [
      { id: 'store-a', name: '京东A店', targetUrl: 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder' },
      { id: 'store-b', name: '京东B店', targetUrl: 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder' },
    ],
    headless: false,
    页面保留模式: 'keep',
    批量下载发票方法: async ({ orders }) => {
      const error = new Error(`诺诺发票系统没有找到可下载发票，缺少 1 张：${orders[0].orderNumber}`);
      error.response = { code: 'INVOICE_NOT_FOUND_IN_NUONUO' };
      throw error;
    },
    执行京东回传会话方法: async ({ 店铺配置, invoiceUploads, headless, 页面保留模式 }) => {
      会话记录.push({
        storeId: 店铺配置.id,
        invoiceUploads,
        headless,
        页面保留模式,
      });
    },
    onProgress: (progress) => 进度记录.push(progress),
  });

  assert.deepEqual(会话记录, [
    { storeId: 'store-a', invoiceUploads: [], headless: false, 页面保留模式: 'keep' },
    { storeId: 'store-b', invoiceUploads: [], headless: false, 页面保留模式: 'keep' },
  ]);
  assert.deepEqual(
    进度记录.filter((progress) => progress.type === 'item').map((progress) => `${progress.status}:${progress.item.orderNumber}`),
    ['downloading:1000000000001', 'skipped:1000000000001', 'downloading:1000000000002', 'skipped:1000000000002'],
  );
  assert.equal(result.successCount, 0);
  assert.equal(result.skippedCount, 2);
  assert.match(result.message, /成功 0\/2 单，跳过 2 单/);
});

test('批量发票回传遇到单张上传失败会继续后续订单', async () => {
  const 调用顺序 = [];
  const 进度记录 = [];
  const result = await 执行批量发票回传({
    orders: [
      {
        key: 'store-a:1000000000001',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000001',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
      {
        key: 'store-a:1000000000002',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000002',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
      {
        key: 'store-a:1000000000003',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000003',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
    ],
    stores: [
      { id: 'store-a', name: '京东A店', targetUrl: 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder' },
    ],
    批量下载发票方法: async ({ orders }) => orders.map((order) => {
      调用顺序.push(`download:${order.orderNumber}`);
      return {
        key: order.key,
        orderNumber: order.orderNumber,
        invoiceFilePath: `D:\\invoice\\${order.orderNumber}.pdf`,
      };
    }),
    执行京东回传会话方法: async ({
      continueOnItemError,
      invoiceUploads,
      onUploadStart,
      onUploadProgress,
      onUploaded,
      onUploadFailed,
    }) => {
      assert.equal(continueOnItemError, true);
      for (const item of invoiceUploads) {
        调用顺序.push(`upload:${item.orderNumber}`);
        await onUploadStart(item);
        await onUploadProgress(item, {
          stage: 'search-order',
          message: `正在查询京东订单：${item.orderNumber}`,
        });
        if (item.orderNumber === '1000000000002') {
          await onUploadFailed(
            { ...item, screenshotPath: `D:\\screenshots\\${item.orderNumber}-error.png` },
            new Error('京东后台列表一直处于加载中，无法判断发票回传入口。'),
          );
          continue;
        }
        await onUploaded({ ...item, screenshotPath: `D:\\screenshots\\${item.orderNumber}.png` });
      }
    },
    设置订单发票回传成功方法: (key, payload) => {
      调用顺序.push(`save:${key}:${payload.invoiceFilePath}:${payload.screenshotPath}`);
    },
    onProgress: (progress) => 进度记录.push(progress),
  });

  assert.deepEqual(调用顺序, [
    'download:1000000000001',
    'download:1000000000002',
    'download:1000000000003',
    'upload:1000000000001',
    'save:store-a:1000000000001:D:\\invoice\\1000000000001.pdf:D:\\screenshots\\1000000000001.png',
    'upload:1000000000002',
    'upload:1000000000003',
    'save:store-a:1000000000003:D:\\invoice\\1000000000003.pdf:D:\\screenshots\\1000000000003.png',
  ]);
  assert.deepEqual(
    进度记录.filter((progress) => progress.type === 'item').map((progress) => `${progress.status}:${progress.item.orderNumber}`),
    [
      'downloading:1000000000001',
      'downloaded:1000000000001',
      'downloading:1000000000002',
      'downloaded:1000000000002',
      'downloading:1000000000003',
      'downloaded:1000000000003',
      'uploading:1000000000001',
      'uploading:1000000000001',
      'success:1000000000001',
      'uploading:1000000000002',
      'uploading:1000000000002',
      'error:1000000000002',
      'uploading:1000000000003',
      'uploading:1000000000003',
      'success:1000000000003',
    ],
  );
  assert.deepEqual(
    进度记录
      .filter((progress) => progress.item?.uploadStage === 'search-order')
      .map((progress) => progress.message),
    [
      '正在查询京东订单：1000000000001',
      '正在查询京东订单：1000000000002',
      '正在查询京东订单：1000000000003',
    ],
  );
  assert.equal(result.successCount, 2);
  assert.equal(result.failedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.totalCount, 3);
  assert.match(result.message, /失败 1 单/);
});

test('批量发票回传后台遇到登录验证才切换可见浏览器', async () => {
  const 调用记录 = [];
  const 进度记录 = [];
  const result = await 执行批量发票回传({
    orders: [
      {
        key: 'store-a:1000000000001',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000001',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
    ],
    stores: [
      { id: 'store-a', name: '京东A店', targetUrl: 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder' },
    ],
    批量下载发票方法: async ({ orders }) => orders.map((order) => ({
      key: order.key,
      orderNumber: order.orderNumber,
      invoiceFilePath: `D:\\invoice\\${order.orderNumber}.pdf`,
    })),
    执行京东回传会话方法: async ({
      headless,
      允许人工登录,
      invoiceUploads,
      onUploaded,
    }) => {
      调用记录.push({
        headless,
        允许人工登录,
        orders: invoiceUploads.map((item) => item.orderNumber),
      });
      if (headless) {
        throw new Error('登录态失效，请先在后台里对该店铺执行一次可见登录。');
      }
      for (const item of invoiceUploads) {
        await onUploaded({ ...item, screenshotPath: `D:\\screenshots\\${item.orderNumber}.png` });
      }
    },
    设置订单发票回传成功方法: () => {},
    onProgress: (progress) => 进度记录.push(progress),
  });

  assert.deepEqual(调用记录, [
    { headless: true, 允许人工登录: false, orders: ['1000000000001'] },
    { headless: false, 允许人工登录: true, orders: ['1000000000001'] },
  ]);
  assert.equal(result.successCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(
    进度记录.some((progress) => String(progress.message || '').includes('正在打开可见浏览器')),
    true,
  );
});

test('批量发票回传普通业务错误不会打开可见浏览器重试', async () => {
  const 调用记录 = [];
  await assert.rejects(
    () => 执行批量发票回传({
      orders: [
        {
          key: 'store-a:1000000000001',
          storeId: 'store-a',
          storeName: '京东A店',
          orderNumber: '1000000000001',
          workflowStatus: 'invoice_registered',
          invoiceStatusKind: 'pending',
          invoiceReturned: false,
        },
      ],
      stores: [
        { id: 'store-a', name: '京东A店', targetUrl: 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder' },
      ],
      批量下载发票方法: async ({ orders }) => orders.map((order) => ({
        key: order.key,
        orderNumber: order.orderNumber,
        invoiceFilePath: `D:\\invoice\\${order.orderNumber}.pdf`,
      })),
      执行京东回传会话方法: async ({ headless }) => {
        调用记录.push({ headless });
        throw new Error('京东后台全部列表没有找到订单 1000000000001，无法判断是否已开票或需要上传。');
      },
      设置订单发票回传成功方法: () => {},
    }),
    /没有找到订单/,
  );

  assert.deepEqual(调用记录, [{ headless: true }]);
});
