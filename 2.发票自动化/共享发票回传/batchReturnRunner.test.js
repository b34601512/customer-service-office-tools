// 该文件用于验证共享批量回传执行器会逐单记进度、按最终结果汇总，并在单店失败后继续后续店铺。

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  构建店铺汇总,
  执行多店铺发票回传,
} = require('./batchReturnRunner');

function 发票已登记订单(storeId, orderNumber) {
  return {
    key: `${storeId}::${orderNumber}`,
    storeId,
    orderNumber,
    workflowStatus: 'invoice_registered',
  };
}

test('店铺结论只由逐单最终状态计算', () => {
  assert.equal(构建店铺汇总({ id: 'a' }, [
    { status: 'success' },
    { status: 'success' },
  ]).status, 'success');
  assert.equal(构建店铺汇总({ id: 'a' }, [
    { status: 'success' },
    { status: 'error' },
  ]).status, 'partial');
  assert.equal(构建店铺汇总({ id: 'a' }, [
    { status: 'skipped' },
    { status: 'skipped' },
  ]).status, 'skipped');
  assert.equal(构建店铺汇总({ id: 'a' }, [
    { status: 'error' },
    { status: 'skipped' },
  ]).status, 'error');
});

test('逐单成功跳过失败都持久记录并形成准确汇总', async () => {
  const persisted = [];
  const result = await 执行多店铺发票回传({
    stores: [{ id: 'store-a', name: 'A店' }],
    读取店铺订单: async () => [
      发票已登记订单('store-a', 'A-1'),
      发票已登记订单('store-a', 'A-2'),
      发票已登记订单('store-a', 'A-3'),
      { ...发票已登记订单('store-a', 'A-4'), workflowStatus: 'processing' },
    ],
    执行单店回传: async ({ onProgress }) => {
      await onProgress({ orderNumber: 'A-1', status: 'uploading', message: '上传中' });
      await onProgress({ orderNumber: 'A-1', status: 'success', message: '成功' });
      await onProgress({ orderNumber: 'A-2', status: 'skipped', message: '缺少发票' });
      await onProgress({ orderNumber: 'A-3', status: 'error', message: '平台拒绝' });
      return { status: 'error' };
    },
    记录订单进度: async ({ item }) => persisted.push(`${item.orderNumber}:${item.status}`),
  });

  assert.deepEqual(result.summary, {
    storeTotal: 1,
    storeSuccess: 0,
    storePartial: 1,
    storeSkipped: 0,
    storeError: 0,
    orderTotal: 3,
    success: 1,
    skipped: 1,
    error: 1,
  });
  assert.deepEqual(result.stores[0].items.map((item) => item.status), ['success', 'skipped', 'error']);
  assert.ok(persisted.includes('A-1:queued'));
  assert.ok(persisted.includes('A-1:uploading'));
  assert.ok(persisted.includes('A-1:success'));
  assert.ok(persisted.includes('A-2:skipped'));
  assert.ok(persisted.includes('A-3:error'));
  assert.equal(persisted.some((item) => item.startsWith('A-4:')), false);
});

test('一个店铺抛错后标记未完成订单失败并继续下一店铺', async () => {
  const visited = [];
  const result = await 执行多店铺发票回传({
    stores: [{ id: 'bad' }, { id: 'good' }],
    读取店铺订单: async (store) => [发票已登记订单(store.id, `${store.id}-1`)],
    执行单店回传: async ({ store, onProgress }) => {
      visited.push(store.id);
      if (store.id === 'bad') throw new Error('店铺页面失效');
      await onProgress({ orderNumber: 'good-1', status: 'success' });
      return { status: 'success' };
    },
  });

  assert.deepEqual(visited, ['bad', 'good']);
  assert.equal(result.stores[0].status, 'error');
  assert.equal(result.stores[0].items[0].message, '店铺页面失效');
  assert.equal(result.stores[1].status, 'success');
  assert.equal(result.summary.storeError, 1);
  assert.equal(result.summary.storeSuccess, 1);
});

test('单店未提供逐单结论时用整体结果补齐，且每批只输出一次汇总', async () => {
  let summaryCalls = 0;
  const result = await 执行多店铺发票回传({
    stores: [{ id: 'only' }],
    读取店铺订单: async () => [发票已登记订单('only', 'O-1')],
    执行单店回传: async () => ({ status: 'success', message: '全部完成' }),
    输出汇总: async () => { summaryCalls += 1; },
  });

  assert.equal(result.stores[0].items[0].status, 'success');
  assert.equal(summaryCalls, 1);
});
