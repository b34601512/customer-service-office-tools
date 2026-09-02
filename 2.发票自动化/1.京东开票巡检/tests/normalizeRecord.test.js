const test = require('node:test');
const assert = require('node:assert/strict');
const { 规范化文本, 规范化记录 } = require('../src/invoice/normalizeRecord');

test('规范化文本会压缩空白并移除空行', () => {
  assert.equal(规范化文本('  发票抬头 \n\n  京东科技  '), '发票抬头 | 京东科技');
});

test('规范化记录会生成稳定摘要和标识', () => {
  const 记录 = 规范化记录({
    订单号: '12345',
    发票抬头: '京东科技',
    税号: '91310000XXXX',
  }, '页面表格');

  assert.equal(记录.source, '页面表格');
  assert.equal(记录.summary, '订单号:12345；发票抬头:京东科技；税号:91310000XXXX');
  assert.equal(typeof 记录.id, 'string');
  assert.equal(记录.id.length, 64);
});
