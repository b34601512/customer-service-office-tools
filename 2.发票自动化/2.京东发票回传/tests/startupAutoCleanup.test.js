const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  自动归档已处理历史记录,
  自动迁移配置店铺旧档案,
  自动归档未配置旧店铺档案,
} = require('../src/common/runtimeCleanup/startupAutoCleanup');
const { 读取订单记录 } = require('../src/order/jdOrderRecordStore');
const { 读取性能清理摘要 } = require('../src/common/performanceCleanupState');

function 创建临时项目目录() {
  // 该函数给启动自动清理测试创建隔离项目，避免碰真实数据。
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jd-startup-auto-cleanup-'));
}

function 写入JSON文件(文件路径, 数据) {
  // 该函数只在测试目录写 JSON，模拟真实订单和旧浏览器档案。
  fs.mkdirSync(path.dirname(文件路径), { recursive: true });
  fs.writeFileSync(文件路径, JSON.stringify(数据, null, 2), 'utf8');
}

function 写入测试文件(文件路径, 内容 = 'x') {
  // 该函数只负责造一个存在的文件，方便验证目录是否被迁移。
  fs.mkdirSync(path.dirname(文件路径), { recursive: true });
  fs.writeFileSync(文件路径, 内容, 'utf8');
}

test('启动自动清理会归档已处理历史并记录性能摘要', () => {
  const projectRoot = 创建临时项目目录();
  const orderRecordFilePath = path.join(projectRoot, 'data', 'invoice-urge-orders.json');
  const 备份根目录 = path.join(projectRoot, 'backup');
  写入JSON文件(orderRecordFilePath, {
    version: 1,
    orders: {
      '京东1店:1001': { key: '京东1店:1001', orderNumber: '1001', handled: true, processing: true, invoiceRegistered: true },
      '京东1店:1002': { key: '京东1店:1002', orderNumber: '1002', handled: false, processing: false, invoiceRegistered: false },
    },
  });

  const result = 自动归档已处理历史记录({
    orderRecordFilePath,
    projectRoot,
    备份根目录,
    now: new Date('2026-06-30T01:00:00Z'),
  });

  const currentData = 读取订单记录(orderRecordFilePath);
  const currentOrders = currentData.orders;
  const summary = 读取性能清理摘要({ projectRoot });
  assert.equal(result.removedCount, 1);
  assert.equal(fs.existsSync(result.backupPath), true);
  assert.equal(currentOrders['京东1店:1001'], undefined);
  assert.equal(currentOrders['京东1店:1002'].orderNumber, '1002');
  assert.equal(currentData.archivedHandledOrders['京东1店:1001'].orderNumber, '1001');
  assert.equal(summary.totals.removedOrderCount, 1);
  assert.equal(summary.autoCleanupRuns[0].cleanupType, 'handled-order-history');
});

test('启动自动清理会把配置店铺旧档案迁移成最小登录态', async () => {
  const projectRoot = 创建临时项目目录();
  const oldProfile = path.join(projectRoot, 'runtime', 'store-profiles', '京东1店');
  const backupPath = path.join(projectRoot, 'backup', '京东1店');
  const seen = [];
  写入测试文件(path.join(oldProfile, 'Default', 'Cache', 'data_1'), 'cache');

  const result = await 自动迁移配置店铺旧档案({
    projectRoot,
    备份根目录: path.join(projectRoot, 'backup'),
    店铺列表: [{ id: '京东1店', targetUrl: 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder' }],
    now: new Date('2026-06-30T01:00:00Z'),
    async 迁移函数(options) {
      seen.push(options);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.renameSync(options.旧浏览器目录, backupPath);
      写入测试文件(options.登录态文件路径, '{"cookies":[]}');
      return { migrated: true, backupPath };
    },
  });

  const summary = 读取性能清理摘要({ projectRoot });
  assert.equal(seen.length, 1);
  assert.match(seen[0].登录态文件路径, /data[\\/]store-auth-states[\\/]京东1店\.json$/);
  assert.equal(result.length, 1);
  assert.equal(fs.existsSync(oldProfile), false);
  assert.equal(fs.existsSync(path.join(backupPath, 'Default', 'Cache', 'data_1')), true);
  assert.equal(summary.autoCleanupRuns[0].cleanupType, 'legacy-store-profile');
  assert.equal(summary.totals.movedCount, 1);
});

test('启动自动清理会迁移未配置店铺旧档案但保留配置店铺目录', () => {
  const projectRoot = 创建临时项目目录();
  const profileRoot = path.join(projectRoot, 'runtime', 'store-profiles');
  const configuredProfile = path.join(profileRoot, '京东1店');
  const orphanProfile = path.join(profileRoot, '已删除店铺');
  const 备份根目录 = path.join(projectRoot, 'backup');
  写入测试文件(path.join(configuredProfile, 'Default', 'Cache', 'data_1'), 'keep');
  写入测试文件(path.join(orphanProfile, 'Default', 'Cache', 'data_2'), 'move');

  const result = 自动归档未配置旧店铺档案({
    projectRoot,
    备份根目录,
    店铺列表: [{ id: '京东1店' }],
    店铺浏览器根目录路径: profileRoot,
    now: new Date('2026-06-30T01:00:00Z'),
  });

  const summary = 读取性能清理摘要({ projectRoot });
  assert.equal(result.length, 1);
  assert.equal(fs.existsSync(configuredProfile), true);
  assert.equal(fs.existsSync(orphanProfile), false);
  assert.match(result[0].备份路径, /runtime[\\/]store-profiles[\\/]已删除店铺$/);
  assert.equal(summary.autoCleanupRuns[0].cleanupType, 'orphan-store-profile');
  assert.equal(summary.totals.movedCount, 1);
});
