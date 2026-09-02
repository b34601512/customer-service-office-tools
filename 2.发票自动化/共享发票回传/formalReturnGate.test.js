const test = require('node:test');
const assert = require('node:assert/strict');
const {
  创建正式回传闸门,
  执行受控正式回传,
} = require('./formalReturnGate');

test('正式回传闸门只选择指定店铺的发票已登记订单', () => {
  const gate = 创建正式回传闸门({
    store: { id: 'store-a' },
    orders: [
      { key: 'store-a:1', storeId: 'store-a', orderNumber: '1', workflowStatus: 'pending' },
      { key: 'store-a:2', storeId: 'store-a', orderNumber: '2', workflowStatus: 'invoice_registered' },
      { key: 'store-b:3', storeId: 'store-b', orderNumber: '3', workflowStatus: 'invoice_registered' },
      { key: 'store-a:4', storeId: 'store-a', orderNumber: '4', workflowStatus: 'handled' },
    ],
  });

  assert.deepEqual(gate.orders.map((item) => item.orderNumber), ['2']);
});

test('不要求已登记时，已同步待回传订单也能进入正式回传', () => {
  const gate = 创建正式回传闸门({
    store: { id: 'store-a' },
    要求已登记: false,
    orders: [
      { key: 'store-a:1', storeId: 'store-a', orderNumber: '1', workflowStatus: 'pending' },
      { key: 'store-a:2', storeId: 'store-a', orderNumber: '2', workflowStatus: 'pending', invoiceReturned: true },
      { key: 'store-a:3', storeId: 'store-a', orderNumber: '3', workflowStatus: 'pending', lastReturnAttempt: { status: 'success' } },
      { key: 'store-a:4', storeId: 'store-a', orderNumber: '4', workflowStatus: 'invoice_registered' },
      { key: 'store-b:5', storeId: 'store-b', orderNumber: '5', workflowStatus: 'pending' },
    ],
  });

  assert.deepEqual(gate.orders.map((item) => item.orderNumber), ['1', '4']);
});

test('正式回传闸门逐单持久化进度并返回最终结果', async () => {
  const attempts = [];
  const gate = 创建正式回传闸门({
    store: { id: 'store-a' },
    orders: [{ key: 'store-a:2', storeId: 'store-a', orderNumber: '2', workflowStatus: 'invoice_registered' }],
    记录订单回传尝试: (key, attempt) => attempts.push({ key, ...attempt }),
  });
  const result = await 执行受控正式回传({
    platformName: '模拟平台',
    store: { id: 'store-a', name: 'A店' },
    gate,
    execute: async (orders, onProgress) => {
      onProgress({ type: 'item', status: 'downloading', message: '下载中', item: orders[0] });
      onProgress({
        type: 'item',
        status: 'success',
        message: '回传成功',
        item: { ...orders[0], invoiceFilePath: 'invoice.pdf', screenshotPath: 'proof.png' },
      });
      return { message: '完成' };
    },
  });

  assert.deepEqual(attempts.map((item) => item.status), ['downloading', 'success']);
  assert.equal(result.status, 'success');
  assert.equal(result.items[0].screenshotPath, 'proof.png');
});

test('没有已登记订单时不执行平台动作', async () => {
  let executed = false;
  const gate = 创建正式回传闸门({
    store: { id: 'store-a' },
    orders: [{ key: 'store-a:1', storeId: 'store-a', orderNumber: '1', workflowStatus: 'pending' }],
  });
  const result = await 执行受控正式回传({
    platformName: '模拟平台',
    store: { id: 'store-a', name: 'A店' },
    gate,
    execute: async () => { executed = true; },
  });

  assert.equal(executed, false);
  assert.equal(result.status, 'skipped');
  assert.match(result.message, /没有发票已登记/);
});

test('店铺级异常会把未结束订单记录为失败以便重试', async () => {
  const attempts = [];
  const gate = 创建正式回传闸门({
    store: { id: 'store-a' },
    orders: [{ key: 'store-a:2', storeId: 'store-a', orderNumber: '2', workflowStatus: 'invoice_registered' }],
    记录订单回传尝试: (key, attempt) => attempts.push({ key, ...attempt }),
  });

  await assert.rejects(
    执行受控正式回传({
      platformName: '模拟平台',
      store: { id: 'store-a' },
      gate,
      execute: async () => { throw new Error('店铺页面失效'); },
    }),
    /店铺页面失效/,
  );
  assert.equal(attempts.at(-1).status, 'error');
});
