const test = require('node:test');
const assert = require('node:assert/strict');
const { 批量单店最大尝试次数, 批量店铺页面保留模式, 批量回传页面保留模式, ControlCenterTaskService } = require('../src/controlCenter/taskService');

function 创建控制台状态桩() {
  // 该函数模拟后台状态对象，验证任务服务是否按预期推送状态。
  return {
    currentTask: null,
    storeResults: [],
    orderRecords: [],
    invoiceReturnReport: null,
    invoiceReturnReports: [],
    setTask(task) {
      this.currentTask = task;
    },
    updateStoreResult(result) {
      this.storeResults.push(result);
    },
    setOrderRecords(records) {
      this.orderRecords = records;
    },
    setInvoiceReturnReport(report) {
      this.invoiceReturnReport = report;
      this.invoiceReturnReports.push(report);
    },
  };
}

function 构建成功巡检结果(storeName) {
  // 该函数生成最小成功结果，避免任务调度测试依赖真实浏览器。
  return {
    checkedAt: new Date().toISOString(),
    metrics: {
      scannedPageCount: 1,
      backendInvoiceOrderCount: 0,
      backendInvoiceInfoUpdatedCount: 0,
      pendingOrderCount: 0,
      processingOrderCount: 0,
      invoiceRegisteredOrderCount: 0,
      handledOrderCount: 0,
    },
    records: [],
    newRecords: [],
    pagePreview: `${storeName} preview`,
    screenshotPath: '',
    reportPath: '',
  };
}

test('全部店铺识别时单店失败不会阻断后续店铺', async () => {
  const state = 创建控制台状态桩();
  const 调用顺序 = [];
  const 页面保留模式列表 = [];
  const headless列表 = [];
  const 人工登录列表 = [];
  const 保存结果 = [];  const 店铺列表 = [
    { id: 'store-a', name: '京东A店', enabled: true },
    { id: 'store-b', name: '京东B店', enabled: true },
    { id: 'store-c', name: '京东C店', enabled: true },
  ];
  const service = new ControlCenterTaskService(state, {
    获取启用店铺列表方法: () => 店铺列表,
    更新店铺结果方法: (result) => {
      保存结果.push(result);
    },
    执行巡检方法: async ({ 店铺配置, 页面保留模式, headless, 允许人工登录 }) => {
      调用顺序.push(店铺配置.name);
      页面保留模式列表.push(页面保留模式);
      headless列表.push(headless);
      人工登录列表.push(允许人工登录);
      if (店铺配置.id === 'store-b') {
        const error = new Error('模拟列表加载失败');
        error.pageDiagnostic = {
          pageTitle: '消费者发票管理',
          pageUrl: 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder',
          pagePreview: '订单编号 发票状态 申请时间 共 5 条',
          screenshotPath: 'runtime/screenshots/store-b-failure.png',
        };
        throw error;
      }
      return 构建成功巡检结果(店铺配置.name);
    },
  });

  service.启动全部排查();
  const runningPromise = service.currentTaskPromise;
  await runningPromise;

  assert.equal(批量单店最大尝试次数, 2);
  assert.equal(批量店铺页面保留模式, 'keep');
  assert.deepEqual(调用顺序, ['京东A店', '京东B店', '京东B店', '京东C店']);
  assert.deepEqual(页面保留模式列表, ['keep', 'keep', 'keep', 'keep']);
  assert.deepEqual(headless列表, [false, false, false, false]);
  assert.deepEqual(人工登录列表, [true, true, true, true]);
  assert.equal(保存结果.filter((result) => result.status === 'success').length, 2);
  assert.equal(保存结果.filter((result) => result.status === 'error').length, 2);
  const 失败结果 = 保存结果.find((result) => result.status === 'error');
  assert.equal(失败结果.pageUrl, 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder');
  assert.equal(失败结果.screenshotPath, 'runtime/screenshots/store-b-failure.png');
  assert.match(失败结果.preview, /订单编号/);
  assert.match(state.currentTask.message, /成功 2\/3，失败 1/);
  assert.match(state.currentTask.message, /京东B店/);
});

test('批量识别全程打开可见浏览器，登录失效也不会退回后台黑窗', async () => {
  const state = 创建控制台状态桩();
  const 调用记录 = [];
  const 店铺列表 = [
    { id: 'store-a', name: '京东A店', enabled: true },
  ];
  const service = new ControlCenterTaskService(state, {
    获取启用店铺列表方法: () => 店铺列表,
    更新店铺结果方法: () => {},
    执行巡检方法: async (选项) => {
      调用记录.push(选项);
      if (调用记录.length === 1) {
        throw new Error('登录态失效，请在可见窗口内完成登录。');
      }
      return 构建成功巡检结果(选项.店铺配置.name);
    },
  });

  service.启动全部排查();
  await service.currentTaskPromise;

  assert.equal(调用记录.length, 2);
  assert.deepEqual(调用记录.map((选项) => 选项.headless), [false, false]);
  assert.deepEqual(调用记录.map((选项) => 选项.允许人工登录), [true, true]);
  assert.deepEqual(调用记录.map((选项) => 选项.页面保留模式), ['keep', 'keep']);
});

test('单店排查仍然打开可见浏览器给人工核对', async () => {
  const state = 创建控制台状态桩();
  const 调用记录 = [];
  const 店铺列表 = [
    { id: 'store-a', name: '京东A店', enabled: true },
  ];
  const service = new ControlCenterTaskService(state, {
    读取店铺配置方法: () => ({ stores: 店铺列表 }),
    更新店铺结果方法: () => {},
    执行巡检方法: async (选项) => {
      调用记录.push(选项);
      return 构建成功巡检结果(选项.店铺配置.name);
    },
  });

  service.启动单店排查('store-a');
  await service.currentTaskPromise;

  assert.equal(调用记录.length, 1);
  assert.equal(调用记录[0].headless, false);
  assert.equal(调用记录[0].允许人工登录, true);
  assert.equal(调用记录[0].页面保留模式, 'wait');
});

test('分页进度会同步到后台任务摘要和巡检报告', async () => {
  const state = 创建控制台状态桩();
  const 店铺列表 = [
    { id: 'store-a', name: '京东A店', enabled: true },
  ];
  const service = new ControlCenterTaskService(state, {
    获取启用店铺列表方法: () => 店铺列表,
    更新店铺结果方法: () => {},
    执行巡检方法: async (选项) => {
      选项.onProgress({
        message: '[#####---------------] 19/75页 25%',
        finishedPageCount: 19,
        totalPageCount: 75,
        percent: 25,
        progressBar: '[#####---------------]',
        pageSize: 10,
        concurrentPageCount: 3,
      });
      return 构建成功巡检结果(选项.店铺配置.name);
    },
  });

  service.启动全部排查();
  await service.currentTaskPromise;

  const 进度结果 = state.storeResults.find((result) => result.progress?.totalPageCount === 75);
  assert.ok(进度结果);
  assert.equal(进度结果.statusLabel, '可见读取中');
  assert.match(进度结果.lastMessage, /19\/75页 25%/);
  assert.match(state.storeResults.map((result) => result.lastMessage || '').join('\n'), /并发=3/);
});

test('识别任务会把批次内成功和失败截图路径传给巡检', async () => {
  const state = 创建控制台状态桩();
  const 巡检选项列表 = [];
  const 店铺列表 = [
    { id: 'store-a', name: '京东A店', enabled: true },
  ];
  const service = new ControlCenterTaskService(state, {
    获取启用店铺列表方法: () => 店铺列表,
    创建凭证批次目录方法: () => 'D:\\evidence\\inspection-batch',
    构建店铺凭证路径方法: ({ 批次目录, 店铺, 结果状态 }) => `${批次目录}\\${店铺.id}-${结果状态}.png`,
    更新店铺结果方法: () => {},
    执行巡检方法: async (选项) => {
      巡检选项列表.push(选项);
      return 构建成功巡检结果(选项.店铺配置.name);
    },
  });

  service.启动全部排查();
  await service.currentTaskPromise;

  assert.equal(巡检选项列表.length, 1);
  assert.equal(巡检选项列表[0].截图路径, 'D:\\evidence\\inspection-batch\\store-a-成功.png');
  assert.equal(巡检选项列表[0].失败截图路径, 'D:\\evidence\\inspection-batch\\store-a-失败.png');
});

test('待开票发票批量回传会筛选本地订单并刷新订单列表', async () => {
  const state = 创建控制台状态桩();
  const 调用记录 = [];
  const 订单数据 = {
    orders: {
      'store-a:1000000000001': {
        key: 'store-a:1000000000001',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000001',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
      'store-a:1000000000002': {
        key: 'store-a:1000000000002',
        storeId: 'store-a',
        storeName: '京东A店',
        orderNumber: '1000000000002',
        workflowStatus: 'invoice_registered',
        invoiceStatusKind: 'pending',
        invoiceReturned: false,
      },
    },
  };
  const 店铺列表 = [
    { id: 'store-a', name: '京东A店', enabled: true },
  ];
  const service = new ControlCenterTaskService(state, {
    读取店铺配置方法: () => ({
      stores: 店铺列表,
    }),
    读取订单记录方法: () => 订单数据,
    记录转列表方法: (data) => Object.values(data.orders || {}),
    创建凭证批次目录方法: () => 'D:\\evidence\\invoice-return-batch',
    执行批量发票回传方法: async (选项) => {
      调用记录.push(选项);
      选项.onProgress({
        type: 'item',
        status: 'downloading',
        message: '正在下载测试发票。',
        item: {
          key: 'store-a:1000000000001',
          storeId: 'store-a',
          storeName: '京东A店',
          orderNumber: '1000000000001',
        },
        updatedAt: new Date().toISOString(),
      });
      选项.onProgress({
        type: 'item',
        status: 'success',
        message: '测试发票已回传。',
        item: {
          key: 'store-a:1000000000001',
          storeId: 'store-a',
          storeName: '京东A店',
          orderNumber: '1000000000001',
          screenshotPath: 'runtime/screenshots/return-success.png',
        },
        updatedAt: new Date().toISOString(),
      });
      选项.onProgress({
        type: 'item',
        status: 'skipped',
        message: '测试发票未开好，已跳过。',
        item: {
          key: 'store-a:1000000000002',
          storeId: 'store-a',
          storeName: '京东A店',
          orderNumber: '1000000000002',
        },
        updatedAt: new Date().toISOString(),
      });
      return { message: '批量发票回传完成：成功 1/2 单，跳过 1 单。' };
    },
  });

  service.启动待开票发票批量回传();
  await service.currentTaskPromise;

  assert.equal(调用记录.length, 1);
  assert.equal(调用记录[0].orders.length, 2);
  assert.equal(调用记录[0].stores[0].name, '京东A店');
  assert.equal(Object.hasOwn(调用记录[0], 'invoiceSystem'), false);
  assert.equal(调用记录[0].headless, false);
  assert.equal(调用记录[0].页面保留模式, 批量回传页面保留模式);
  assert.equal(批量回传页面保留模式, 'keep');
  assert.equal(调用记录[0].凭证批次目录, 'D:\\evidence\\invoice-return-batch');
  assert.equal(typeof 调用记录[0].onProgress, 'function');
  assert.equal(state.orderRecords.length, 2);
  assert.equal(state.invoiceReturnReport.status, 'success');
  assert.equal(state.invoiceReturnReport.items.length, 2);
  assert.equal(state.invoiceReturnReport.items[0].status, 'success');
  assert.equal(state.invoiceReturnReport.items[0].screenshotPath, 'runtime/screenshots/return-success.png');
  assert.equal(state.invoiceReturnReport.items[1].status, 'skipped');
  assert.equal(state.invoiceReturnReport.items[1].statusLabel, '已跳过');
  assert.match(state.currentTask.message, /成功 1\/2/);
  assert.match(state.currentTask.message, /跳过 1/);
});

test('批量回传任务失败会保留结构化失败状态', async () => {
  const state = 创建控制台状态桩();
  const service = new ControlCenterTaskService(state, {
    读取店铺配置方法: () => ({ stores: [{ id: 'store-a', name: '京东A店' }] }),
    读取订单记录方法: () => ({
      orders: {
        'store-a:1000000000001': {
          key: 'store-a:1000000000001',
          storeId: 'store-a',
          storeName: '京东A店',
          orderNumber: '1000000000001',
          workflowStatus: 'invoice_registered',
          invoiceStatusKind: 'pending',
          invoiceReturned: false,
        },
      },
    }),
    记录转列表方法: (data) => Object.values(data.orders || {}),
    创建凭证批次目录方法: () => '',
    执行批量发票回传方法: async () => {
      throw new Error('模拟京东页面打开失败');
    },
  });

  service.启动待开票发票批量回传();
  const runningPromise = service.currentTaskPromise;
  await runningPromise;

  assert.equal(state.currentTask.status, 'error');
  assert.equal(state.currentTask.label, '失败');
  assert.equal(state.currentTask.errorMessage, '模拟京东页面打开失败');
  assert.match(state.currentTask.message, /任务失败/);
});

test('批量和单店识别分别保存摘要，单店不会覆盖批量总览', async () => {
  const state = 创建控制台状态桩();
  const 批量摘要列表 = [];
  const 单店摘要列表 = [];
  const 店铺列表 = [
    { id: 'store-a', name: '京东A店', enabled: true },
    { id: 'store-b', name: '京东B店', enabled: true },
  ];
  const service = new ControlCenterTaskService(state, {
    获取启用店铺列表方法: () => 店铺列表,
    读取店铺配置方法: () => ({ stores: 店铺列表 }),
    读取订单记录方法: () => ({ orders: {} }),
    记录转列表方法: () => [],
    创建凭证批次目录方法: () => '',
    更新最近批量摘要方法: (摘要) => 批量摘要列表.push(摘要),
    更新最近单店摘要方法: (摘要) => 单店摘要列表.push(摘要),
    更新店铺结果方法: () => {},
    执行巡检方法: async (选项) => 构建成功巡检结果(选项.店铺配置.name),
  });

  service.启动全部排查();
  await service.currentTaskPromise;

  assert.equal(批量摘要列表.length, 1);
  assert.equal(批量摘要列表[0].executionType, 'batch');
  assert.equal(批量摘要列表[0].storeCount, 2);
  assert.equal(批量摘要列表[0].successStoreCount, 2);
  const 最近批量摘要 = 批量摘要列表[0];

  service.启动单店排查('store-a');
  await service.currentTaskPromise;

  assert.equal(单店摘要列表.length, 1);
  assert.equal(单店摘要列表[0].executionType, 'single');
  assert.equal(单店摘要列表[0].storeCount, 1);
  assert.equal(批量摘要列表[0], 最近批量摘要);
});
