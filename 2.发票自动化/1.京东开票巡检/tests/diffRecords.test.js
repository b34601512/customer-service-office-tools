const test = require('node:test');
const assert = require('node:assert/strict');
const { 计算新增记录 } = require('../src/invoice/diffRecords');

test('只返回历史快照中不存在的记录', () => {
  const 旧记录 = [{ id: 'A' }, { id: 'B' }];
  const 新记录 = [{ id: 'A' }, { id: 'C' }];
  assert.deepEqual(计算新增记录(旧记录, 新记录), [{ id: 'C' }]);
});
