const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/order/pddOrderRecordStore');

test('拼多多仓库隔离平台状态、人工阶段和单次回传状态', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdd-order-store-'));
  const filePath = path.join(directory, 'orders.json');
  const shop = { id: 'pdd-a', name: '拼多多A店' };
  store.同步待处理订单({
    store: shop,
    orders: [{ orderNumber: '123456-1234567890', orderStatus: '交易成功', afterSaleStatus: '无售后' }],
  }, filePath);
  store.更新订单工作流状态('pdd-a:123456-1234567890', 'processing', filePath);
  store.更新订单工作流状态('pdd-a:123456-1234567890', 'invoice_registered', filePath);
  let order = store.读取店铺发票已登记订单(shop, filePath)[0];
  assert.equal(order.platformStatus.text, '交易成功｜售后：无售后');
  store.设置订单回传尝试(order.key, { status: 'error', message: '平台超时' }, filePath);
  order = store.读取订单列表(filePath)[0];
  assert.equal(order.workflowStatus, 'invoice_registered');
  assert.equal(order.lastReturnAttempt.status, 'error');
  store.设置订单回传尝试(order.key, { status: 'success', message: '完成' }, filePath);
  assert.equal(store.读取订单列表(filePath)[0].workflowStatus, 'handled');
});
