const test = require('node:test');
const assert = require('node:assert/strict');
const { 执行抖音发票正式回传 } = require('../src/app/returnInvoiceToDouyin');

test('抖音正式回传没有发票已登记订单时不启动平台流程', async () => {
  let executed = false;
  const result = await 执行抖音发票正式回传({
    店铺配置: { id: 'douyin-a', name: '抖音A店' },
    orders: [
      { key: 'douyin-a:1', storeId: 'douyin-a', orderNumber: '1', workflowStatus: 'pending' },
      { key: 'douyin-a:2', storeId: 'douyin-a', orderNumber: '2', workflowStatus: 'handled' },
    ],
    执行回传方法: async () => { executed = true; },
  });

  assert.equal(executed, false);
  assert.equal(result.status, 'skipped');
  assert.match(result.message, /没有发票已登记/);
});
