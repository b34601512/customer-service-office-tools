const test = require('node:test');
const assert = require('node:assert/strict');
const { 规范化记录 } = require('../src/invoice/normalizeRecord');
const { 选择需要提醒的开票记录 } = require('../src/invoice/selectInvoiceAlertRecords');

function 构建待登记记录(订单号 = '3489470007408765') {
  // 解决：统一生成一条还有 8 天逾期的待登记记录，覆盖提前发现的报警场景。
  return 规范化记录({
    销售订单编号: 订单号,
    发票上传时间: '-',
    '发票上传倒计时（天）': '还有8天逾期',
  }, '页面表格');
}

test('有新增待登记记录时优先提醒新增记录', () => {
  const 新增记录 = [构建待登记记录()];
  const 提醒记录 = 选择需要提醒的开票记录({
    当前记录: 新增记录,
    新增记录,
    上次指标: { 待登记明细数: 0 },
    本次指标: { 待登记明细数: 1 },
  });

  assert.equal(提醒记录.length, 1);
  assert.equal(提醒记录[0].id, 新增记录[0].id);
});

test('旧逻辑漏报过的存量待登记记录会补发一次提醒', () => {
  const 存量记录 = [构建待登记记录()];
  const 提醒记录 = 选择需要提醒的开票记录({
    当前记录: 存量记录,
    新增记录: [],
    上次指标: { 待登记明细数: 0 },
    本次指标: { 待登记明细数: 1 },
  });

  assert.equal(提醒记录.length, 1);
  assert.equal(提醒记录[0].id, 存量记录[0].id);
});

test('上次已经发现待登记时不重复补发存量记录', () => {
  const 存量记录 = [构建待登记记录()];
  const 提醒记录 = 选择需要提醒的开票记录({
    当前记录: 存量记录,
    新增记录: [],
    上次指标: { 待登记明细数: 1 },
    本次指标: { 待登记明细数: 1 },
  });

  assert.equal(提醒记录.length, 0);
});
