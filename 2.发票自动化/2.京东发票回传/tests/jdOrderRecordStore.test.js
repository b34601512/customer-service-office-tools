// 该文件用于验证京东旧订单会备份迁移到唯一 workflowStatus，并完整保留京东字段、回传凭证和归档索引。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  读取订单记录,
  记录转列表,
  记住扫描到的催票订单,
  同步扫描到的发票订单信息,
  设置订单处理中状态,
  设置订单发票登记状态,
  设置订单备注,
  设置订单跟进客服,
  设置订单回传尝试,
  设置订单发票回传成功,
  归档清理已处理订单,
} = require('../src/order/jdOrderRecordStore');

function 创建临时文件() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-workflow-store-')), 'orders.json');
}

function 写JSON(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

test('旧三布尔记录先复制备份再迁移，京东字段、回传证据和归档索引不丢', () => {
  const file = 创建临时文件();
  const key = '京东1店:1001';
  写JSON(file, {
    version: 1,
    orders: {
      [key]: {
        key,
        storeId: '京东1店',
        storeName: '京东1店',
        orderNumber: '1001',
        processing: true,
        invoiceRegistered: true,
        handled: false,
        assigneeName: '张三',
        noteText: '保留备注',
        invoiceStatusKind: 'pending',
        invoiceStatusText: '待开票',
        invoiceTitle: '测试抬头',
        invoiceReturnFilePath: 'D:\\invoice\\1001.pdf',
        invoiceReturnScreenshotPath: 'D:\\proof\\1001.png',
        invoiceReturnMessage: '上次失败，可重试',
      },
    },
    archivedHandledOrders: {
      '京东1店:old': { key: '京东1店:old', orderNumber: 'old', backupPath: 'D:\\backup\\old.json' },
    },
    handledArchiveIndexBuiltAt: '2026-08-01T00:00:00.000Z',
  });

  const data = 读取订单记录(file);
  const order = data.orders[key];
  assert.equal(order.workflowStatus, 'invoice_registered');
  assert.equal(Object.hasOwn(order, 'processing'), false);
  assert.equal(Object.hasOwn(order, 'invoiceRegistered'), false);
  assert.equal(Object.hasOwn(order, 'handled'), false);
  assert.equal(order.assigneeName, '张三');
  assert.equal(order.noteText, '保留备注');
  assert.equal(order.invoiceStatusText, '待开票');
  assert.equal(order.invoiceTitle, '测试抬头');
  assert.equal(order.invoiceReturnFilePath, 'D:\\invoice\\1001.pdf');
  assert.equal(order.invoiceReturnScreenshotPath, 'D:\\proof\\1001.png');
  assert.equal(data.archivedHandledOrders['京东1店:old'].orderNumber, 'old');
  assert.ok(data.workflowMigration.backupPath);
  assert.equal(fs.existsSync(data.workflowMigration.backupPath), true);
  assert.equal(JSON.parse(fs.readFileSync(data.workflowMigration.backupPath, 'utf8')).version, 1);
});

test('重新扫描只更新后台事实，人工阶段、负责人、备注和回传凭证保持不变', () => {
  const file = 创建临时文件();
  const first = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东一店' },
    records: [{ orderNumber: '1002', summary: '首次扫描' }],
  }, file);
  const key = first.records[0].key;
  设置订单处理中状态(key, true, file);
  设置订单跟进客服(key, '李四', file);
  设置订单备注(key, '客户催过一次', file);
  设置订单发票登记状态(key, true, file);
  设置订单回传尝试(key, { status: 'error', message: '平台暂不可用', invoiceFilePath: 'D:\\invoice\\1002.pdf' }, file);

  同步扫描到的发票订单信息({
    store: { id: '京东1店', name: '京东一店' },
    invoiceOrders: [{
      orderNumber: '1002',
      invoiceStatusKind: 'success',
      invoiceStatusText: '开票成功',
      invoiceTitle: '新抬头',
      invoiceAmountText: '¥88.00',
    }],
  }, file);

  const order = 记录转列表(读取订单记录(file), file)[0];
  assert.equal(order.workflowStatus, 'invoice_registered');
  assert.equal(order.assigneeName, '李四');
  assert.equal(order.noteText, '客户催过一次');
  assert.equal(order.lastReturnAttempt.status, 'error');
  assert.equal(order.invoiceStatusKind, 'success');
  assert.equal(order.platformStatus.text, '开票成功');
  assert.equal(order.invoiceTitle, '新抬头');
});

test('回传失败保留发票已登记，成功保存凭证并自动进入已处理', () => {
  const file = 创建临时文件();
  const result = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东一店' },
    records: [{ orderNumber: '1003' }],
  }, file);
  const key = result.records[0].key;
  设置订单处理中状态(key, true, file);
  设置订单发票登记状态(key, true, file);
  设置订单回传尝试(key, { status: 'skipped', message: '缺少文件' }, file);
  assert.equal(读取订单记录(file).orders[key].workflowStatus, 'invoice_registered');

  设置订单发票回传成功(key, {
    invoiceFilePath: 'D:\\invoice\\1003.pdf',
    screenshotPath: 'D:\\proof\\1003.png',
    message: '回传完成',
  }, file);
  const order = 读取订单记录(file).orders[key];
  assert.equal(order.workflowStatus, 'handled');
  assert.equal(order.lastReturnAttempt.status, 'success');
  assert.equal(order.invoiceReturned, true);
  assert.equal(order.invoiceReturnFilePath, 'D:\\invoice\\1003.pdf');
  assert.equal(order.invoiceReturnScreenshotPath, 'D:\\proof\\1003.png');
});

test('归档仍保留完整京东订单，活动区只留轻量防复活索引', () => {
  const file = 创建临时文件();
  const backupRoot = path.join(path.dirname(file), 'archive-backup');
  const result = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东一店' },
    records: [{ orderNumber: '1004', invoiceTitle: '归档抬头' }],
  }, file);
  const key = result.records[0].key;
  设置订单处理中状态(key, true, file);
  设置订单发票登记状态(key, true, file);
  设置订单发票回传成功(key, { invoiceFilePath: 'D:\\invoice\\1004.pdf' }, file);

  const archived = 归档清理已处理订单(file, {
    备份根目录: backupRoot,
    now: new Date('2026-08-07T10:00:00.000Z'),
  });
  const current = 读取订单记录(file);
  const backup = JSON.parse(fs.readFileSync(archived.backupPath, 'utf8'));
  assert.equal(archived.removedCount, 1);
  assert.equal(current.orders[key], undefined);
  assert.equal(current.archivedHandledOrders[key].orderNumber, '1004');
  assert.equal(backup.orders[key].invoiceTitle, '归档抬头');
  assert.equal(backup.orders[key].invoiceReturnFilePath, 'D:\\invoice\\1004.pdf');
});
