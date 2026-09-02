const test = require('node:test');
const assert = require('node:assert/strict');
const { 构建历史结果总览 } = require('../src/store/storeResultService');

test('旧版每店结果可以在首次启动时组合成历史总览', () => {
  const 摘要 = 构建历史结果总览({
    stores: {
      'store-a': {
        storeId: 'store-a',
        storeName: '京东A店',
        status: 'success',
        lastCheckedAt: '2026-08-05T01:00:00.000Z',
        records: [{ orderNumber: '1' }],
        newRecords: [{ orderNumber: '1' }],
        metrics: { scannedRecordCount: 1, newRecordCount: 1 },
      },
      'store-b': {
        storeId: 'store-b',
        storeName: '京东B店',
        status: 'error',
        lastCheckedAt: '2026-08-05T02:00:00.000Z',
        records: [],
        newRecords: [],
        metrics: {},
      },
    },
  });

  assert.equal(摘要.executionType, 'legacy');
  assert.equal(摘要.resultLabel, '历史店铺结果总览');
  assert.equal(摘要.storeCount, 2);
  assert.equal(摘要.successStoreCount, 1);
  assert.equal(摘要.failedStoreCount, 1);
  assert.equal(摘要.scannedRecordCount, 1);
  assert.equal(摘要.newRecordCount, 1);
});

test('没有旧店铺结果时不制造虚假的历史总览', () => {
  assert.equal(构建历史结果总览({ stores: {} }), null);
});
