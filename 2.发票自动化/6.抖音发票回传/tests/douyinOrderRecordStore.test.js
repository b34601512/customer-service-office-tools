const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/order/douyinOrderRecordStore');

test('空快照清理本店旧队列，但保留成功凭证和其他店；成功单重现不再回传', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-history-'));
  const filePath = path.join(directory, 'orders.json');
  const shop = { id: 'a', name: 'A店' };
  store.同步待处理订单({ store: shop, orders: [{ orderNumber: '1' }, { orderNumber: '2' }] }, filePath);
  store.同步待处理订单({ store: { id: 'b', name: 'B店' }, orders: [{ orderNumber: '3' }] }, filePath);
  store.设置订单回传尝试('a:1', { status: 'downloading' }, filePath);
  assert.equal(store.读取订单列表(filePath).find((o) => o.key === 'a:1').workflowStatus, 'processing');
  store.设置订单回传尝试('a:1', { status: 'success', screenshotPath: 'proof.png' }, filePath);
  store.同步待处理订单({ store: shop, orders: [] }, filePath);
  let records = store.读取订单列表(filePath);
  assert.deepEqual(records.map((o) => o.key).sort(), ['a:1', 'b:3']);
  assert.equal(records.find((o) => o.key === 'a:1').invoiceReturnScreenshotPath, 'proof.png');
  store.同步待处理订单({ store: shop, orders: [{ orderNumber: '1' }] }, filePath);
  assert.equal(store.读取店铺发票已登记订单(shop, { 要求已登记: false }, filePath).length, 0);
});

test('抖音仓库持久保存四阶段与平台报表字段', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-order-store-'));
  const filePath = path.join(directory, 'orders.json');
  const shop = { id: 'douyin-a', name: '抖音A店' };
  store.同步待处理订单({
    store: shop,
    orders: [{ orderNumber: '900000000001', subOrderNumber: 'sub-1', orderStatus: '已完成', invoiceStatus: '待开票', invoiceUploadMode: '上传发票' }],
  }, filePath);
  store.更新订单工作流状态('douyin-a:900000000001', 'processing', filePath);
  store.更新订单工作流状态('douyin-a:900000000001', 'invoice_registered', filePath);
  let order = store.读取订单列表(filePath)[0];
  assert.equal(order.subOrderNumber, 'sub-1');
  assert.match(order.platformStatus.text, /发票：待开票/);
  store.设置订单回传尝试(order.key, { status: 'skipped', message: '尚未开票' }, filePath);
  order = store.读取订单列表(filePath)[0];
  assert.equal(order.workflowStatus, 'invoice_registered');
  store.设置订单回传尝试(order.key, { status: 'success', message: '完成', screenshotPath: 'proof.png' }, filePath);
  order = store.读取订单列表(filePath)[0];
  assert.equal(order.workflowStatus, 'handled');
  assert.equal(order.invoiceReturnScreenshotPath, 'proof.png');
});
