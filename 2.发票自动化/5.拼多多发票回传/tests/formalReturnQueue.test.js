const test = require('node:test');
const assert = require('node:assert/strict');
const { 执行拼多多发票正式回传 } = require('../src/app/returnInvoiceToPdd');

test('拼多多正式回传只消费发票已登记订单，跳过后仍可重试', async () => {
  const received = [];
  const attempts = [];
  const result = await 执行拼多多发票正式回传({
    店铺配置: { id: 'pdd-a', name: '拼多多A店' },
    orders: [
      { key: 'pdd-a:1', storeId: 'pdd-a', orderNumber: '1', workflowStatus: 'processing' },
      { key: 'pdd-a:2', storeId: 'pdd-a', orderNumber: '2', workflowStatus: 'invoice_registered' },
    ],
    记录订单回传尝试方法: (key, attempt) => attempts.push({ key, ...attempt }),
    执行回传方法: async ({ orders, onProgress }) => {
      received.push(...orders);
      onProgress({ type: 'item', status: 'skipped', message: '尚未开票', item: orders[0] });
      return { message: '已跳过', orders, uploads: [] };
    },
  });

  assert.deepEqual(received.map((item) => item.orderNumber), ['2']);
  assert.equal(attempts.at(-1).status, 'skipped');
  assert.equal(result.items[0].workflowStatus, 'invoice_registered');
  assert.equal(result.items[0].status, 'skipped');
});
