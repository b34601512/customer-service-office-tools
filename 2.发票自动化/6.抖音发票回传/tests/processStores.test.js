const test = require('node:test');
const assert = require('node:assert/strict');
const { 逐店同步并回传 } = require('../src/app/processStores');

const stores = [{ id: 'a', name: 'A店' }, { id: 'b', name: 'B店' }];
const order = (id, number = '1') => ({ key: `${id}:${number}`, storeId: id, orderNumber: number });

test('按A同步→A回传→B同步→B回传执行一次，仅回传本轮快照订单', async () => {
  const calls = [];
  const result = await 逐店同步并回传({
    stores,
    依赖: {
      同步店铺: async ({ 店铺配置: store }) => { calls.push(`sync:${store.id}`); return { orders: [order(store.id)] }; },
      读取待回传订单: (store) => [order(store.id), order(store.id, '旧订单')],
      回传店铺: async ({ 店铺配置: store, orders, 要求已登记 }) => {
        calls.push(`return:${store.id}`);
        assert.equal(要求已登记, false);
        assert.deepEqual(orders, [order(store.id)]);
        return { status: 'success', message: '完成', items: orders.map((o) => ({ ...o, status: 'success' })) };
      },
    },
  });
  assert.deepEqual(calls, ['sync:a', 'return:a', 'sync:b', 'return:b']);
  assert.equal(result.summary.success, 2);
});

test('A同步失败不读取旧队列、不回传A，仍完整处理B', async () => {
  const calls = [];
  const result = await 逐店同步并回传({
    stores,
    依赖: {
      同步店铺: async ({ 店铺配置: store }) => { calls.push(`sync:${store.id}`); if (store.id === 'a') throw new Error('报表失败'); return { orders: [order('b')] }; },
      读取待回传订单: (store) => { calls.push(`read:${store.id}`); return [order(store.id)]; },
      回传店铺: async ({ 店铺配置: store }) => { calls.push(`return:${store.id}`); return { status: 'skipped', items: [{ ...order('b'), status: 'skipped' }] }; },
    },
  });
  assert.deepEqual(calls, ['sync:a', 'sync:b', 'read:b', 'return:b']);
  assert.equal(result.summary.storeError, 1);
  assert.equal(result.summary.skipped, 1);
});

test('空快照以及已成功订单不会启动回传', async () => {
  const result = await 逐店同步并回传({
    stores,
    依赖: {
      同步店铺: async ({ 店铺配置: store }) => ({ orders: store.id === 'a' ? [] : [order('b')] }),
      读取待回传订单: (store) => store.id === 'a' ? [order('a')] : [],
      回传店铺: async () => assert.fail('不应启动回传'),
    },
  });
  assert.deepEqual(result.stores.map((r) => r.status), ['skipped', 'skipped']);
});

test('部分回传成功后异常保留成功计数，未完成订单计失败且继续下一店', async () => {
  const result = await 逐店同步并回传({
    stores,
    依赖: {
      同步店铺: async ({ 店铺配置: store }) => ({ orders: store.id === 'a' ? [order('a'), order('a', '2')] : [] }),
      读取待回传订单: (store) => [order(store.id), order(store.id, '2')],
      回传店铺: async ({ onProgress }) => {
        onProgress({ item: order('a'), status: 'success', message: '完成' });
        throw new Error('页面已关闭');
      },
    },
  });
  assert.equal(result.stores.length, 2);
  assert.equal(result.stores[0].status, 'partial');
  assert.equal(result.summary.success, 1);
  assert.equal(result.summary.error, 1);
});
