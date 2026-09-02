const test = require('node:test');
const assert = require('node:assert/strict');
const {
  获取订单统计,
  读取本地处理阶段,
  读取后台开票状态,
  筛选订单,
  订单匹配搜索,
} = require('../src/order/jdOrderRecordStore');

const 订单列表 = [
  { key: '店铺A:1', storeName: '京东A店', orderNumber: '1', workflowStatus: 'pending', invoiceStatusKind: 'pending', invoiceStatusText: '待开票' },
  { key: '店铺A:2', storeName: '京东A店', orderNumber: '2', workflowStatus: 'processing', invoiceStatusKind: 'success', invoiceStatusText: '开票成功' },
  { key: '店铺A:3', storeName: '京东A店', orderNumber: '3', workflowStatus: 'invoice_registered', invoiceStatusKind: 'failed', invoiceStatusText: '开票失败' },
  { key: '店铺A:4', storeName: '京东A店', orderNumber: '4', workflowStatus: 'handled', invoiceStatusKind: 'success', invoiceStatusText: '开票成功' },
];

test('订单状态统计与筛选共用同一套口径', () => {
  assert.deepEqual(获取订单统计(订单列表), {
    total: 4,
    pending: 1,
    processing: 1,
    invoiceRegistered: 1,
    handled: 1,
  });
  assert.equal(筛选订单(订单列表, 'pending').length, 1);
  assert.equal(筛选订单(订单列表, 'processing').length, 1);
  assert.equal(筛选订单(订单列表, 'invoiceRegistered').length, 1);
  assert.equal(筛选订单(订单列表, 'handled').length, 1);
  assert.equal(筛选订单(订单列表, 'backendSuccess').length, 2);
  assert.equal(筛选订单(订单列表, 'backendPending').length, 1);
  assert.equal(筛选订单(订单列表, 'backendFailed').length, 1);
});

test('订单列表同时展示本地处理阶段和京东开票状态', () => {
  assert.equal(读取本地处理阶段(订单列表[0]), '待处理');
  assert.equal(读取本地处理阶段(订单列表[2]), '发票已登记');
  assert.deepEqual(读取后台开票状态(订单列表[1]), { kind: 'success', text: '开票成功' });
  assert.equal(订单匹配搜索(订单列表[1], '开票成功'), true);
  assert.equal(订单匹配搜索(订单列表[1], '不存在的订单'), false);
});
