const test = require('node:test');
const assert = require('node:assert/strict');
const { 从页面文本提取开票指标 } = require('../src/invoice/invoicePageMetrics');

test('顶部警告数字为 1 时提取即将逾期数量', () => {
  const 指标 = 从页面文本提取开票指标('警告：您有1笔订单剩余处理时间不足5天（即将逾期），请立即完成上传操作。');

  assert.equal(指标.警告订单数, 1);
  assert.equal(指标.页面警告订单数, 1);
  assert.equal(指标.顶部警告已识别, true);
});

test('顶部警告数字为 0 时不产生告警', () => {
  const 指标 = 从页面文本提取开票指标('警告：您有0笔订单剩余处理时间不足5天（即将逾期），请立即完成上传操作。');

  assert.equal(指标.警告订单数, 0);
  assert.equal(指标.页面警告订单数, 0);
  assert.equal(指标.顶部警告已识别, true);
});

test('顶部数字被样式拆开产生空格或分隔符时仍能提取', () => {
  const 指标 = 从页面文本提取开票指标('警告：您有 | 2 | 笔订单剩余处理时间不足 5 天（即将逾期） | 总共 3 条。');

  assert.equal(指标.警告订单数, 2);
  assert.equal(指标.页面警告订单数, 2);
  assert.equal(指标.明细总数, 3);
});

test('核心指标差额大于 0 时即使顶部警告为 0 也产生告警', () => {
  const 指标 = 从页面文本提取开票指标('警告：您有0笔订单剩余处理时间不足5天（即将逾期） | 核心指标 | 及时上传发票订单数 | 0 | 应上传发票订单数 | 1 | 总共1条。');

  assert.equal(指标.页面警告订单数, 0);
  assert.equal(指标.及时上传发票订单数, 0);
  assert.equal(指标.应上传发票订单数, 1);
  assert.equal(指标.待上传发票订单数, 1);
  assert.equal(指标.警告订单数, 1);
});

test('核心指标差额为 0 时不产生告警', () => {
  const 指标 = 从页面文本提取开票指标('核心指标 | 及时上传发票订单数 | 3 | 应上传发票订单数 | 3 | 总共3条。');

  assert.equal(指标.上传指标已识别, true);
  assert.equal(指标.待上传发票订单数, 0);
  assert.equal(指标.警告订单数, 0);
});
