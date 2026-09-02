const test = require('node:test');
const assert = require('node:assert/strict');
const {
  构建发票订单列表,
  筛选催促订单,
  归类发票状态,
} = require('../src/consumerInvoice/invoiceApiMapper');

test('只把 ckFlag 为真的订单登记为催促开票', () => {
  const invoiceOrders = 构建发票订单列表([
    {
      orderId: 1111111111111,
      ckFlag: true,
      applyTime: '2026-06-26 10:00:00',
      orderCompleteTime: '2026-06-25 10:00:00',
      invoiceAmount: 100,
      invoiceTitle: '测试抬头',
      sourceName: '消费者申请补开',
      invoiceStatusName: '待开票',
      consumerPhone: '13800000000',
    },
    {
      orderId: 2222222222222,
      ckFlag: false,
      invoiceStatusName: '待开票',
    },
  ]);
  const records = 筛选催促订单(invoiceOrders);

  assert.deepEqual(records.map((record) => record.orderNumber), ['1111111111111']);
  assert.equal(records[0].source, '京东接口催促标记 ckFlag');
  assert.equal(records[0].invoiceAmountText, '￥100.00');
  assert.doesNotMatch(records[0].rowText, /13800000000/);
});

test('接口缺少 ckFlag 时直接失败，禁止退回文本猜测', () => {
  assert.throws(
    () => 构建发票订单列表([{ orderId: 1111111111111, invoiceStatusName: '待开票' }]),
    /缺少布尔字段 ckFlag/,
  );
});

test('发票状态会归类为本地展示状态', () => {
  assert.equal(归类发票状态('开票成功'), 'success');
  assert.equal(归类发票状态('待开票'), 'pending');
  assert.equal(归类发票状态('已驳回'), 'failed');
});
