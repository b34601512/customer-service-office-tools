const test = require('node:test');
const assert = require('node:assert/strict');
const { 同步天猫待处理订单 } = require('../src/app/syncPendingOrders');

test('天猫同步只打开并读取订单，并保持浏览器供后续回传核实', async () => {
  const calls = [];
  const context = {
    pages: () => [{ isClosed: () => false }],
    close: async () => calls.push('close'),
  };
  const result = await 同步天猫待处理订单({
    店铺配置: { id: 'tmall-a', name: '天猫A店' },
    依赖: {
      创建浏览器上下文: async () => { calls.push('context'); return context; },
      打开待回传页面: async () => calls.push('open'),
      读取待回传订单: async () => { calls.push('read'); return [{ orderNumber: '1001' }]; },
      导出订单留痕: async () => { calls.push('export-orders'); return 'tmall-orders.csv'; },
      保存同步订单: async () => {
        calls.push('save');
        return { addedRecords: [{}], updatedRecords: [], stats: { pending: 1 } };
      },
    },
  });

  assert.deepEqual(calls, ['context', 'open', 'read', 'export-orders', 'save']);
  assert.equal(result.readOnly, true);
  assert.equal(result.orderCount, 1);
  assert.equal(result.exportFilePath, 'tmall-orders.csv');
});
