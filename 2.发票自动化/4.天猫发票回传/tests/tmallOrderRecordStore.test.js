const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/order/tmallOrderRecordStore');

test('天猫只读同步幂等保留人工字段，成功才进入已处理', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmall-order-store-'));
  const filePath = path.join(directory, 'orders.json');
  const shop = { id: 'tmall-a', name: '天猫A店' };
  store.同步待处理订单({
    store: shop,
    orders: [{ orderNumber: '1001', invoiceAmount: '88.00', operationStatus: '可录入发票' }],
  }, filePath);
  store.更新订单工作流状态('tmall-a:1001', 'processing', filePath);
  store.更新订单工作流状态('tmall-a:1001', 'invoice_registered', filePath);
  store.设置订单备注('tmall-a:1001', '等财务开票', filePath);
  store.同步待处理订单({
    store: shop,
    orders: [{ orderNumber: '1001', invoiceAmount: '99.00', operationStatus: '可录入发票' }],
  }, filePath);

  let order = store.读取订单列表(filePath)[0];
  assert.equal(order.workflowStatus, 'invoice_registered');
  assert.equal(order.noteText, '等财务开票');
  assert.equal(order.invoiceAmount, '99.00');
  assert.equal(Object.hasOwn(order, 'processing'), false);
  store.设置订单回传尝试(order.key, { status: 'skipped', message: '未找到发票' }, filePath);
  assert.equal(store.读取订单列表(filePath)[0].workflowStatus, 'invoice_registered');
  store.设置订单回传尝试(order.key, {
    status: 'success', message: '回传完成', invoiceFilePath: '1001.pdf', screenshotPath: '1001.png',
  }, filePath);
  order = store.读取订单列表(filePath)[0];
  assert.equal(order.workflowStatus, 'handled');
  assert.equal(order.invoiceReturned, true);
  assert.equal(order.invoiceReturnScreenshotPath, '1001.png');
});

test('天猫同步会按后台最新列表清理本店旧订单，但不影响其他店铺', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmall-order-store-refresh-'));
  const filePath = path.join(directory, 'orders.json');
  store.同步待处理订单({
    store: { id: 'tmall-a', name: '天猫A店' },
    orders: [{ orderNumber: 'old-a' }, { orderNumber: 'keep-a' }],
  }, filePath);
  store.同步待处理订单({
    store: { id: 'tmall-b', name: '天猫B店' },
    orders: [{ orderNumber: 'keep-b' }],
  }, filePath);

  store.同步待处理订单({
    store: { id: 'tmall-a', name: '天猫A店' },
    orders: [{ orderNumber: 'keep-a' }],
  }, filePath);

  assert.deepEqual(
    store.读取订单列表(filePath).map((order) => order.key).sort(),
    ['tmall-a:keep-a', 'tmall-b:keep-b'],
  );
});

test('天猫后台返回空列表时会清空本店旧订单', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmall-order-store-empty-'));
  const filePath = path.join(directory, 'orders.json');
  store.同步待处理订单({
    store: { id: 'tmall-a', name: '天猫A店' },
    orders: [{ orderNumber: '1001' }],
  }, filePath);
  store.同步待处理订单({ store: { id: 'tmall-a', name: '天猫A店' }, orders: [] }, filePath);
  assert.deepEqual(store.读取订单列表(filePath), []);
});
