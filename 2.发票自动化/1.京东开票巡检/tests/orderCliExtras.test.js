const test = require('node:test');
const assert = require('node:assert/strict');
const { 读取订单倒计时 } = require('../src/cli/startCli');

test('订单 CLI 继续展示旧网页已有的发票上传倒计时', () => {
  assert.equal(读取订单倒计时({
    fields: {
      '发票上传倒计时开始时间': '2026-08-01',
      '发票上传倒计时': '还有 3 天逾期',
    },
  }), '还有 3 天逾期');
  assert.equal(读取订单倒计时({ invoiceCountdownText: '已逾期' }), '已逾期');
});
