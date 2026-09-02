const test = require('node:test');
const assert = require('node:assert/strict');
const { 同步抖音待处理订单 } = require('../src/app/syncPendingOrders');

test('抖音同步只读取并解析订单报表，不调用任何回传动作', async () => {
  const calls = [];
  const context = {
    pages: () => [{ isClosed: () => false }],
    close: async () => calls.push('close'),
  };
  const result = await 同步抖音待处理订单({
    店铺配置: { id: 'douyin-a', name: '抖音A店' },
    依赖: {
      创建浏览器上下文: async () => { calls.push('context'); return context; },
      打开待回传页面: async () => calls.push('open'),
      读取当前页订单: async () => { calls.push('read-page'); return [{ orderNumber: '900000000001' }]; },
      导出订单报表: async () => { calls.push('export-orders'); return 'orders.xlsx'; },
      读取订单报表: () => { calls.push('parse-orders'); return [{ orderNumber: '900000000001', invoiceStatus: '待开票' }]; },
      保存同步订单: async () => {
        calls.push('save');
        return { addedRecords: [{}], updatedRecords: [], stats: { pending: 1 } };
      },
    },
  });

  // 浏览器保持打开供人工核实，除非退出程序否则不自动关闭。
  assert.deepEqual(calls, ['context', 'open', 'read-page', 'export-orders', 'parse-orders', 'save']);
  assert.equal(result.readOnly, true);
  assert.equal(result.exportFilePath, 'orders.xlsx');
});

test('抖音页面没有待回传订单时不触发订单导出', async () => {
  let exportCalled = false;
  const result = await 同步抖音待处理订单({
    店铺配置: { id: 'douyin-a', name: '抖音A店' },
    依赖: {
      创建浏览器上下文: async () => ({ pages: () => [{ isClosed: () => false }], close: async () => {} }),
      打开待回传页面: async () => {},
      读取当前页订单: async () => [],
      导出订单报表: async () => { exportCalled = true; return 'orders.xlsx'; },
      保存同步订单: async () => ({ addedRecords: [], updatedRecords: [], stats: { pending: 0 } }),
    },
  });
  assert.equal(exportCalled, false);
  assert.equal(result.orderCount, 0);
});
