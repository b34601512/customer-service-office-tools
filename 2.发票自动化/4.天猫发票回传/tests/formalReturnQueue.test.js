const test = require('node:test');
const assert = require('node:assert/strict');
const { 执行天猫发票正式回传 } = require('../src/app/returnInvoiceToTmall');

test('天猫正式回传按已同步待回传队列回传，不要求发票已登记', async () => {
  const received = [];
  const attempts = [];
  const result = await 执行天猫发票正式回传({
    店铺配置: { id: 'tmall-a', name: '天猫A店' },
    要求已登记: false,
    orders: [
      { key: 'tmall-a:1', storeId: 'tmall-a', orderNumber: '1', workflowStatus: 'pending' },
      { key: 'tmall-a:2', storeId: 'tmall-a', orderNumber: '2', workflowStatus: 'invoice_registered' },
      { key: 'tmall-a:3', storeId: 'tmall-a', orderNumber: '3', workflowStatus: 'pending', invoiceReturned: true },
      { key: 'tmall-b:4', storeId: 'tmall-b', orderNumber: '4', workflowStatus: 'pending' },
    ],
    记录订单回传尝试方法: (key, attempt) => attempts.push({ key, ...attempt }),
    执行回传方法: async ({ orders, onProgress }) => {
      received.push(...orders);
      onProgress({ type: 'item', status: 'success', message: '完成', item: orders[0] });
      return { message: '完成', orders, uploads: [] };
    },
  });

  assert.deepEqual(received.map((item) => item.orderNumber), ['1', '2']);
  assert.equal(attempts.at(-1).status, 'success');
  assert.equal(result.items[0].status, 'success');
});
