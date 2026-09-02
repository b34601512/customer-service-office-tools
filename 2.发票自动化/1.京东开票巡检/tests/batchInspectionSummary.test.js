const test = require('node:test');
const assert = require('node:assert/strict');
const {
  构建批量巡检摘要,
  构建批量任务完成消息,
} = require('../src/cli/batchInspectionSummary');

test('全部店铺成功时批量摘要应该标记为巡检成功', () => {
  const 摘要 = 构建批量巡检摘要({
    startedAt: '2026-06-03T00:40:00.000Z',
    finishedAt: '2026-06-03T00:41:40.000Z',
    enabledStores: [
      { id: 'store-a', name: '京东1店' },
      { id: 'store-b', name: '京东2店' },
    ],
    storeResults: [
      { storeId: 'store-a', status: 'success' },
      { storeId: 'store-b', status: 'success' },
    ],
  });

  assert.equal(摘要.status, 'success');
  assert.equal(摘要.resultLabel, '巡检成功');
  assert.equal(摘要.storeCount, 2);
  assert.equal(摘要.checkedStoreCount, 2);
  assert.equal(摘要.failedStoreCount, 0);
  assert.match(构建批量任务完成消息(摘要), /2 家店铺已全部排查/);
});

test('有失败或未完成店铺时批量摘要应该标记为有问题', () => {
  const 摘要 = 构建批量巡检摘要({
    startedAt: '2026-06-03T00:40:00.000Z',
    finishedAt: '2026-06-03T00:41:40.000Z',
    enabledStores: [
      { id: 'store-a', name: '京东1店' },
      { id: 'store-b', name: '京东2店' },
      { id: 'store-c', name: '京东3店' },
    ],
    storeResults: [
      { storeId: 'store-a', status: 'success' },
      { storeId: 'store-b', status: 'error' },
    ],
  });

  assert.equal(摘要.status, 'error');
  assert.equal(摘要.resultLabel, '巡检有问题');
  assert.deepEqual(摘要.failedStoreNames, ['京东2店']);
  assert.deepEqual(摘要.uncheckedStoreNames, ['京东3店']);
  assert.match(构建批量任务完成消息(摘要), /失败 1 家/);
  assert.match(构建批量任务完成消息(摘要), /未完成 1 家/);
});
