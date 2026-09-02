const test = require('node:test');
const assert = require('node:assert/strict');
const {
  获取最近批量总览,
  获取最近单店总览,
  输出首页总览,
} = require('../src/cli/inspectionOverview');

function 创建终端主题() {
  return {
    正文: (文本) => 文本,
    小标题: (文本) => 文本,
    成功: (文本) => 文本,
    失败: (文本) => 文本,
    提醒: (文本) => 文本,
    弱化: (文本) => 文本,
  };
}

function 创建订单列表() {
  return [
    { key: '店铺A:1', storeName: '京东A店', orderNumber: '1', invoiceStatusKind: 'pending' },
    { key: '店铺A:2', storeName: '京东A店', orderNumber: '2', workflowStatus: 'processing', invoiceStatusKind: 'success' },
    { key: '店铺A:3', storeName: '京东A店', orderNumber: '3', workflowStatus: 'invoice_registered', invoiceStatusKind: 'success' },
    { key: '店铺A:4', storeName: '京东A店', orderNumber: '4', workflowStatus: 'handled', invoiceStatusKind: 'pending' },
  ];
}

test('首页会显示最近批量总览的处理日期和订单状态', () => {
  const 输出内容 = [];
  const 结果对象 = {
    lastBatchSummary: {
      executionType: 'batch',
      status: 'success',
      startedAt: '2026-08-05T09:10:11.000Z',
      finishedAt: '2026-08-05T09:20:21.000Z',
      storeCount: 5,
      checkedStoreCount: 5,
      successStoreCount: 5,
      failedStoreCount: 0,
      uncheckedStoreCount: 0,
      scannedRecordCount: 17,
      newRecordCount: 2,
      failedStoreNames: [],
      uncheckedStoreNames: [],
    },
    lastSingleSummary: {
      executionType: 'single',
      status: 'success',
      startedAt: '2026-08-05T10:00:00.000Z',
      finishedAt: '2026-08-05T10:01:00.000Z',
      storeCount: 1,
      checkedStoreCount: 1,
      successStoreCount: 1,
      failedStoreCount: 0,
      uncheckedStoreCount: 0,
      scannedRecordCount: 3,
      newRecordCount: 1,
      failedStoreNames: [],
      uncheckedStoreNames: [],
    },
  };

  输出首页总览({
    输出: (内容) => 输出内容.push(String(内容)),
    终端: { 主题: 创建终端主题() },
    配置: { stores: [{ enabled: true }, { enabled: true }, { enabled: false }] },
    结果对象,
    订单列表: 创建订单列表(),
  });

  const 首页文本 = 输出内容.join('\n');
  assert.match(首页文本, /最近5店总览/);
  assert.match(首页文本, /开始 2026-08-05 17:10:11/);
  assert.match(首页文本, /结束 2026-08-05 17:20:21/);
  assert.match(首页文本, /待处理 1｜处理中 1｜发票已登记 1｜已处理 1/);
  assert.match(首页文本, /开票成功 2｜待开票 2/);
  assert.match(首页文本, /最近单店记录/);
  assert.match(首页文本, /已配置店铺：3 家｜启用 2 家/);
});

test('首页没有批量记录时仍会显示上一次单店记录', () => {
  const 输出内容 = [];
  const 单店摘要 = { executionType: 'single', status: 'success', startedAt: '2026-08-05T11:00:00.000Z', finishedAt: '2026-08-05T11:01:00.000Z', storeCount: 1, checkedStoreCount: 1, successStoreCount: 1, failedStoreCount: 0, uncheckedStoreCount: 0 };

  输出首页总览({
    输出: (内容) => 输出内容.push(String(内容)),
    配置: { stores: [] },
    结果对象: { lastSingleSummary: 单店摘要 },
    订单列表: [],
  });

  assert.match(输出内容.join('\n'), /最近识别总览/);
  assert.equal(获取最近批量总览({ lastBatchSummary: null }), null);
  assert.equal(获取最近单店总览({ lastSingleSummary: 单店摘要 }), 单店摘要);
});
