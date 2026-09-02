const test = require('node:test');
const assert = require('node:assert/strict');
const { 同步拼多多待处理订单 } = require('../src/app/syncPendingOrders');

test('拼多多同步只读取订单并释放浏览器，让正式回传可立即接管店铺资料', async () => {
  const calls = [];
  const context = {
    pages: () => [{ isClosed: () => false }],
    close: async () => calls.push('close'),
  };
  const result = await 同步拼多多待处理订单({
    店铺配置: { id: 'pdd-a', name: '拼多多A店' },
    依赖: {
      创建浏览器上下文: async () => { calls.push('context'); return context; },
      打开待回传页面: async () => calls.push('open'),
      读取当前页订单: async () => { calls.push('read-page'); return [{ orderNumber: '123456-1234567890' }]; },
      导出订单报表: async () => { calls.push('export-orders'); return 'orders.csv'; },
      读取订单报表: () => { calls.push('parse-orders'); return [{ orderNumber: '123456-1234567890', orderStatus: '完成' }]; },
      保存同步订单: async () => {
        calls.push('save');
        return { addedRecords: [{}], updatedRecords: [], stats: { pending: 1 } };
      },
    },
  });

  assert.deepEqual(calls, ['context', 'open', 'read-page', 'export-orders', 'parse-orders', 'save', 'close']);
  assert.equal(result.readOnly, true);
  assert.equal(result.exportFilePath, 'orders.csv');
});

test('拼多多完整报表不可用时仍保存当前可见订单', async () => {
  let savedOrders = [];
  let contextClosed = false;
  const result = await 同步拼多多待处理订单({
    店铺配置: { id: 'pdd-a', name: '拼多多A店' },
    依赖: {
      创建浏览器上下文: async () => ({
        pages: () => [{ isClosed: () => false }],
        close: async () => { contextClosed = true; },
      }),
      打开待回传页面: async () => {},
      读取当前页订单: async () => [{ orderNumber: '123456-1234567890' }],
      导出订单报表: async () => { throw new Error('导出按钮不可用'); },
      保存同步订单: async ({ orders }) => {
        savedOrders = orders;
        return { addedRecords: [{}], updatedRecords: [], stats: { pending: 1 } };
      },
    },
  });
  assert.equal(savedOrders.length, 1);
  assert.equal(contextClosed, true);
  assert.match(result.warning, /导出按钮不可用/);
});
