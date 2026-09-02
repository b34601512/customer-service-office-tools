const test = require('node:test');
const assert = require('node:assert/strict');
const { 构建跟进表文本 } = require('../src/cli/followUpExporter');

test('客服跟进表只导出处理中和发票已登记订单', () => {
  const 结果 = 构建跟进表文本([
    { storeName: '京东A店', orderNumber: '待处理', invoiceStatusText: '待开票' },
    { storeName: '京东A店', orderNumber: '处理中', workflowStatus: 'processing', assigneeName: '小王', noteText: '已联系' },
    { storeName: '京东B店', orderNumber: '已登记', workflowStatus: 'invoice_registered', invoiceReturned: true, invoiceStatusText: '开票成功' },
    { storeName: '京东B店', orderNumber: '已处理', workflowStatus: 'handled' },
  ]);

  assert.equal(结果.count, 2);
  assert.match(结果.text, /处理阶段\t店铺\t订单号/);
  assert.match(结果.text, /处理中\t京东A店\t处理中\t小王\t已联系/);
  assert.match(结果.text, /发票已登记\t京东B店\t已登记/);
  assert.match(结果.text, /已登记.*开票成功.*已回传/);
  assert.doesNotMatch(结果.text, /待处理/);
  assert.doesNotMatch(结果.text, /已处理/);
});
