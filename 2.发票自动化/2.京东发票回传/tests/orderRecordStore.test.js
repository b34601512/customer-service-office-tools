const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  读取订单记录,
  记录转列表,
  统计订单记录,
  记住扫描到的催票订单,
  同步扫描到的发票订单信息,
  手动新增待处理订单,
  设置订单处理状态,
  批量标记开票成功已登记订单为已处理,
  归档清理已处理订单,
  设置订单处理中状态,
  设置订单跟进客服,
  设置订单发票登记状态,
  设置订单备注,
  设置订单发票回传成功,
} = require('../src/order/jdOrderRecordStore');

function 创建临时记录文件() {
  // 该函数用于给每个测试创建独立 JSON 文件，避免状态互相污染。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-invoice-urge-'));
  return path.join(dir, 'orders.json');
}

function 写入测试JSON(文件路径, 数据) {
  // 该函数用于构造测试用 JSON 文件，避免测试依赖真实运行数据。
  fs.mkdirSync(path.dirname(文件路径), { recursive: true });
  fs.writeFileSync(文件路径, JSON.stringify(数据, null, 2), 'utf8');
}

test('扫描到的催票订单会永久落盘为待处理', () => {
  const file = 创建临时记录文件();
  const result = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [{ orderNumber: '3510496013617049', summary: '订单 3510496013617049 标记了催促开票', rowText: '3510496013617049 催促开票' }],
  }, file);

  assert.equal(result.addedRecords.length, 1);
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 1,
    pending: 1,
    processing: 0,
    invoiceRegistered: 0,
    handled: 0,
  });
});

test('手动新增订单会直接进入待处理并永久落盘', () => {
  const file = 创建临时记录文件();
  const result = 手动新增待处理订单({
    store: { id: '京东1店', name: '京东1店' },
    orderNumber: '3510496013617049',
    noteText: '客服群手动登记',
  }, file);

  assert.equal(result.created, true);
  assert.equal(result.order.workflowStatus, 'pending');
  assert.equal(Object.hasOwn(result.order, 'processing'), false);
  assert.equal(Object.hasOwn(result.order, 'invoiceRegistered'), false);
  assert.equal(Object.hasOwn(result.order, 'handled'), false);
  assert.equal(result.order.noteText, '客服群手动登记');
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 1,
    pending: 1,
    processing: 0,
    invoiceRegistered: 0,
    handled: 0,
  });
});

test('手动新增已存在订单会去重、追加备注并保留当前人工阶段', () => {
  const file = 创建临时记录文件();
  const scan = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [{ orderNumber: '3510496013617049', summary: '订单 3510496013617049 标记了催促开票', rowText: '3510496013617049 催促开票' }],
  }, file);
  const key = scan.records[0].key;

  设置订单备注(key, '第一次排查', file);
  设置订单处理中状态(key, true, file);
  设置订单处理状态(key, true, file);
  const result = 手动新增待处理订单({
    store: { id: '京东1店', name: '京东1店' },
    orderNumber: '3510496013617049',
    noteText: '再次手动加入',
  }, file);

  assert.equal(result.created, false);
  assert.equal(result.records.length, 1);
  assert.equal(result.order.workflowStatus, 'handled');
  assert.equal(result.order.noteText, '第一次排查\n再次手动加入');
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 1,
    pending: 0,
    processing: 0,
    invoiceRegistered: 0,
    handled: 1,
  });
});

test('处理中、备注和已处理状态会保留在同一订单记录上', () => {
  const file = 创建临时记录文件();
  const scan = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [{ orderNumber: '3510496013617049', summary: '订单 3510496013617049 标记了催促开票', rowText: '3510496013617049 催促开票' }],
  }, file);
  const key = scan.records[0].key;

  设置订单处理中状态(key, true, file);
  设置订单备注(key, '客户已经催过一次', file);
  设置订单处理状态(key, true, file);

  const records = 记录转列表(读取订单记录(file));
  assert.equal(records[0].workflowStatus, 'handled');
  assert.equal(records[0].noteText, '客户已经催过一次');
  assert.equal(统计订单记录(读取订单记录(file)).handled, 1);
});

test('发票回传成功会记录凭证并把订单推进已处理', () => {
  const file = 创建临时记录文件();
  const scan = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [{ orderNumber: '3510496013617049', summary: '订单 3510496013617049 标记了催促开票', rowText: '3510496013617049 催促开票' }],
  }, file);
  const key = scan.records[0].key;

  设置订单处理中状态(key, true, file);
  设置订单发票登记状态(key, true, file);
  设置订单发票回传成功(key, {
    invoiceFilePath: 'D:\\invoice\\3510496013617049.pdf',
    message: '测试回传成功',
  }, file);
  记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [{ orderNumber: '3510496013617049', summary: '再次扫描', rowText: '3510496013617049 再次扫描' }],
  }, file);

  const records = 记录转列表(读取订单记录(file));
  assert.equal(records[0].workflowStatus, 'handled');
  assert.equal(records[0].invoiceReturned, true);
  assert.equal(records[0].invoiceReturnFilePath, 'D:\\invoice\\3510496013617049.pdf');
  assert.equal(records[0].invoiceReturnMessage, '测试回传成功');
  assert.match(records[0].invoiceReturnedAt, /\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 1,
    pending: 0,
    processing: 0,
    invoiceRegistered: 0,
    handled: 1,
  });
});

test('安排跟进客服会把待处理订单转为处理中并永久落盘', () => {
  const file = 创建临时记录文件();
  const scan = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [{ orderNumber: '3510496013617049', summary: '订单 3510496013617049 标记了催促开票', rowText: '3510496013617049 催促开票' }],
  }, file);
  const key = scan.records[0].key;

  设置订单跟进客服(key, '张三', file);
  记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [{ orderNumber: '3510496013617049', summary: '订单 3510496013617049 标记了催促开票', rowText: '3510496013617049 再次扫描' }],
  }, file);

  let records = 记录转列表(读取订单记录(file));
  assert.equal(records[0].workflowStatus, 'processing');
  assert.equal(records[0].assigneeName, '张三');
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 1,
    pending: 0,
    processing: 1,
    invoiceRegistered: 0,
    handled: 0,
  });

  设置订单处理中状态(key, false, file);
  records = 记录转列表(读取订单记录(file));
  assert.equal(records[0].workflowStatus, 'pending');
  assert.equal(records[0].assigneeName, '张三');
});

test('扫描到的后台发票信息会更新本地已有订单', () => {
  const file = 创建临时记录文件();
  const scan = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [{ orderNumber: '3510496013617049', summary: '订单 3510496013617049 标记了催促开票', rowText: '3510496013617049 催促开票' }],
  }, file);
  const key = scan.records[0].key;
  设置订单处理中状态(key, true, file);
  设置订单发票登记状态(key, true, file);

  const result = 同步扫描到的发票订单信息({
    store: { id: '京东1店', name: '京东1店' },
    invoiceOrders: [{
      orderNumber: '3510496013617049',
      invoiceApplicationTime: '2026-06-01 14:34:34',
      orderCompletionTime: '2026-05-31 07:34:47',
      invoiceCountdownText: '剩余4天14分26秒',
      invoiceTypeText: '电子普票',
      invoiceAmountText: '¥1197.60',
      invoiceTitle: '天津市南开区人民政府广开街道办事处',
      invoiceSource: '消费者申请补开',
      invoiceStatusText: '待开票',
      invoiceStatusKind: 'pending',
      invoiceBackendRowText: '3510496013617049 催促开票 待开票',
    }],
  }, file);

  const records = 记录转列表(读取订单记录(file));
  assert.equal(result.updatedCount, 1);
  assert.equal(records[0].workflowStatus, 'invoice_registered');
  assert.equal(records[0].invoiceStatusText, '待开票');
  assert.equal(records[0].invoiceStatusKind, 'pending');
  assert.equal(records[0].invoiceCountdownText, '剩余4天14分26秒');
  assert.equal(records[0].invoiceAmountText, '¥1197.60');
  assert.equal(records[0].invoiceTitle, '天津市南开区人民政府广开街道办事处');
  assert.match(records[0].invoiceBackendUpdatedAt, /\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 1,
    pending: 0,
    processing: 0,
    invoiceRegistered: 1,
    handled: 0,
  });
});

test('后台普通订单没有本地记录时不会被批量创建', () => {
  const file = 创建临时记录文件();
  const result = 同步扫描到的发票订单信息({
    store: { id: '京东1店', name: '京东1店' },
    invoiceOrders: [{ orderNumber: '3441286014458391', invoiceStatusText: '开票成功', invoiceStatusKind: 'success' }],
  }, file);

  assert.equal(result.updatedCount, 0);
  assert.equal(记录转列表(读取订单记录(file)).length, 0);
});

test('一键处理只会把开票成功的已登记订单标记为已处理', () => {
  const file = 创建临时记录文件();
  const scan = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [
      { orderNumber: '1000000000001', summary: '开票成功且已登记', rowText: '1000000000001 催促开票' },
      { orderNumber: '1000000000002', summary: '待开票且已登记', rowText: '1000000000002 催促开票' },
      { orderNumber: '1000000000003', summary: '已处理成功订单', rowText: '1000000000003 催促开票' },
      { orderNumber: '1000000000004', summary: '未登记成功订单', rowText: '1000000000004 催促开票' },
    ],
  }, file);
  const keys = Object.fromEntries(scan.records.map((order) => [order.orderNumber, order.key]));
  设置订单处理中状态(keys['1000000000001'], true, file);
  设置订单发票登记状态(keys['1000000000001'], true, file);
  设置订单处理中状态(keys['1000000000002'], true, file);
  设置订单发票登记状态(keys['1000000000002'], true, file);
  设置订单处理中状态(keys['1000000000003'], true, file);
  设置订单处理状态(keys['1000000000003'], true, file);
  同步扫描到的发票订单信息({
    store: { id: '京东1店', name: '京东1店' },
    invoiceOrders: [
      { orderNumber: '1000000000001', invoiceStatusText: '开票成功', invoiceStatusKind: 'success' },
      { orderNumber: '1000000000002', invoiceStatusText: '待开票', invoiceStatusKind: 'pending' },
      { orderNumber: '1000000000003', invoiceStatusText: '开票成功', invoiceStatusKind: 'success' },
      { orderNumber: '1000000000004', invoiceStatusText: '开票成功', invoiceStatusKind: 'success' },
    ],
  }, file);

  const result = 批量标记开票成功已登记订单为已处理(file);
  const records = Object.fromEntries(记录转列表(读取订单记录(file)).map((order) => [order.orderNumber, order]));

  assert.equal(result.updatedCount, 1);
  assert.equal(records['1000000000001'].workflowStatus, 'handled');
  assert.equal(records['1000000000002'].workflowStatus, 'invoice_registered');
  assert.equal(records['1000000000003'].workflowStatus, 'handled');
  assert.equal(records['1000000000004'].workflowStatus, 'pending');
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 4,
    pending: 1,
    processing: 0,
    invoiceRegistered: 1,
    handled: 2,
  });
});

test('归档清理已处理订单会先写备份再移出当前记录', () => {
  const file = 创建临时记录文件();
  const projectRoot = path.dirname(file);
  const 备份根目录 = path.join(projectRoot, 'backup');
  const scan = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [
      { orderNumber: '1000000000001', summary: '待处理订单', rowText: '1000000000001 催促开票' },
      { orderNumber: '1000000000002', summary: '处理中订单', rowText: '1000000000002 催促开票' },
      { orderNumber: '1000000000003', summary: '已登记订单', rowText: '1000000000003 催促开票' },
      { orderNumber: '1000000000004', summary: '已处理订单', rowText: '1000000000004 催促开票' },
    ],
  }, file);
  const keys = Object.fromEntries(scan.records.map((order) => [order.orderNumber, order.key]));
  设置订单处理中状态(keys['1000000000002'], true, file);
  设置订单处理中状态(keys['1000000000003'], true, file);
  设置订单发票登记状态(keys['1000000000003'], true, file);
  设置订单处理中状态(keys['1000000000004'], true, file);
  设置订单处理状态(keys['1000000000004'], true, file);

  const result = 归档清理已处理订单(file, {
    projectRoot,
    备份根目录,
    now: new Date('2026-06-29T09:00:00Z'),
  });
  const currentData = 读取订单记录(file);
  const currentOrders = Object.fromEntries(记录转列表(currentData).map((order) => [order.orderNumber, order]));
  const archived = JSON.parse(fs.readFileSync(result.backupPath, 'utf8'));

  assert.equal(result.removedCount, 1);
  assert.equal(fs.existsSync(result.backupPath), true);
  assert.equal(currentData.archivedHandledOrders['京东1店:1000000000004'].orderNumber, '1000000000004');
  assert.equal(currentOrders['1000000000001'].workflowStatus, 'pending');
  assert.equal(currentOrders['1000000000002'].workflowStatus, 'processing');
  assert.equal(currentOrders['1000000000003'].workflowStatus, 'invoice_registered');
  assert.equal(currentOrders['1000000000004'], undefined);
  assert.equal(archived.removedCount, 1);
  assert.equal(Object.values(archived.orders)[0].orderNumber, '1000000000004');
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 3,
    pending: 1,
    processing: 1,
    invoiceRegistered: 1,
    handled: 0,
  });
});

test('扫描不会把已归档已处理订单重新拉回待处理', () => {
  const file = 创建临时记录文件();
  const projectRoot = path.dirname(file);
  const 备份根目录 = path.join(projectRoot, 'backup');
  const scan = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [{ orderNumber: '1000000000001', summary: '已处理订单', rowText: '1000000000001 催促开票' }],
  }, file);
  设置订单处理中状态(scan.records[0].key, true, file);
  设置订单处理状态(scan.records[0].key, true, file);
  归档清理已处理订单(file, {
    projectRoot,
    备份根目录,
    now: new Date('2026-06-29T09:00:00Z'),
  });

  const result = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [
      { orderNumber: '1000000000001', summary: '归档后再次出现', rowText: '1000000000001 催促开票' },
      { orderNumber: '1000000000002', summary: '真正新增订单', rowText: '1000000000002 催促开票' },
    ],
  }, file);
  const currentOrders = Object.fromEntries(记录转列表(读取订单记录(file)).map((order) => [order.orderNumber, order]));

  assert.equal(result.skippedArchivedRecords.length, 1);
  assert.equal(result.skippedArchivedRecords[0].orderNumber, '1000000000001');
  assert.deepEqual(result.addedRecords.map((order) => order.orderNumber), ['1000000000002']);
  assert.equal(currentOrders['1000000000001'], undefined);
  assert.equal(currentOrders['1000000000002'].workflowStatus, 'pending');
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 1,
    pending: 1,
    processing: 0,
    invoiceRegistered: 0,
    handled: 0,
  });
});

test('旧版本备份区已处理归档会补成轻量索引', () => {
  const file = 创建临时记录文件();
  const projectRoot = path.dirname(file);
  const 备份根目录 = path.join(projectRoot, 'backup');
  const archivePath = path.join(备份根目录, '京东催促开票-已处理订单归档', '20260629-090000', 'invoice-urge-orders-handled.json');
  写入测试JSON(file, {
    version: 1,
    orders: {
      '京东1店:1000000000001': {
        key: '京东1店:1000000000001',
        storeId: '京东1店',
        storeName: '京东1店',
        orderNumber: '1000000000001',
        handled: false,
        processing: false,
        invoiceRegistered: false,
      },
    },
  });
  写入测试JSON(archivePath, {
    version: 1,
    archivedAt: '2026-06-29T09:00:00.000Z',
    removedCount: 1,
    orders: {
      '京东1店:1000000000001': {
        key: '京东1店:1000000000001',
        storeId: '京东1店',
        storeName: '京东1店',
        orderNumber: '1000000000001',
        handled: true,
        processing: true,
        invoiceRegistered: true,
      },
    },
  });

  const cleanup = 归档清理已处理订单(file, {
    projectRoot,
    备份根目录,
    now: new Date('2026-07-01T09:00:00Z'),
  });
  const orderData = 读取订单记录(file);
  const rescan = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [{ orderNumber: '1000000000001', summary: '旧归档订单再次出现', rowText: '1000000000001 催促开票' }],
  }, file);

  assert.equal(cleanup.removedCount, 0);
  assert.equal(orderData.archivedHandledOrders['京东1店:1000000000001'].backupPath, archivePath);
  assert.equal(orderData.orders['京东1店:1000000000001'], undefined);
  assert.equal(rescan.skippedArchivedRecords.length, 1);
  assert.equal(记录转列表(读取订单记录(file)).length, 0);
});

test('已处理取消后回到已登记，取消登记后回到处理中，取消处理中后回到待处理', () => {
  const file = 创建临时记录文件();
  const scan = 记住扫描到的催票订单({
    store: { id: '京东1店', name: '京东1店' },
    records: [{ orderNumber: '3510496013617049', summary: '订单 3510496013617049 标记了催促开票', rowText: '3510496013617049 催促开票' }],
  }, file);
  const key = scan.records[0].key;

  设置订单处理中状态(key, true, file);
  设置订单处理状态(key, true, file);
  设置订单处理状态(key, false, file);

  let records = 记录转列表(读取订单记录(file));
  assert.equal(records[0].workflowStatus, 'invoice_registered');
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 1,
    pending: 0,
    processing: 0,
    invoiceRegistered: 1,
    handled: 0,
  });

  设置订单发票登记状态(key, false, file);
  records = 记录转列表(读取订单记录(file));
  assert.equal(records[0].workflowStatus, 'processing');
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 1,
    pending: 0,
    processing: 1,
    invoiceRegistered: 0,
    handled: 0,
  });

  设置订单处理中状态(key, false, file);
  records = 记录转列表(读取订单记录(file));
  assert.equal(records[0].workflowStatus, 'pending');
  assert.deepEqual(统计订单记录(读取订单记录(file)), {
    total: 1,
    pending: 1,
    processing: 0,
    invoiceRegistered: 0,
    handled: 0,
  });
});
