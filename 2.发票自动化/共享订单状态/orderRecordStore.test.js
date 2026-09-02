// 该文件用于验证共享仓库的迁移备份、去重保留、物理隔离、归档防复活和回传状态规则。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { 工作流状态 } = require('./orderWorkflow');
const { 创建订单记录仓库 } = require('./orderRecordStore');

function 创建测试仓库(name = 'orders') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-order-store-'));
  const filePath = path.join(root, `${name}.json`);
  const backupRoot = path.join(root, 'migration-backup');
  const archiveRoot = path.join(root, 'handled-archive');
  const fixedNow = new Date('2026-08-07T08:00:00.000Z');
  return {
    root,
    filePath,
    backupRoot,
    archiveRoot,
    repository: 创建订单记录仓库({
      filePath,
      archiveRoot,
      importArchiveIndexBeforeSync: true,
      nowProvider: () => fixedNow,
      buildMigrationBackupPath: (sourcePath) => path.join(backupRoot, path.basename(sourcePath)),
      buildArchivePath: (_sourcePath, _now, batchName) => path.join(archiveRoot, batchName, `${name}-handled.json`),
    }),
  };
}

function 写入JSON(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

test('旧京东三布尔字段迁移前复制备份，迁移后只保留 workflowStatus 且字段不丢', () => {
  const setup = 创建测试仓库('jd-orders');
  写入JSON(setup.filePath, {
    version: 1,
    orders: {
      's:1': {
        key: 's:1',
        storeId: 's',
        orderNumber: '1',
        processing: true,
        invoiceRegistered: true,
        handled: false,
        invoiceReturnFilePath: 'D:\\invoice\\1.pdf',
        jdOnlyField: '必须保留',
      },
    },
    archivedHandledOrders: { 's:old': { key: 's:old', orderNumber: 'old' } },
  });

  const firstRead = setup.repository.读取订单数据();
  const stored = JSON.parse(fs.readFileSync(setup.filePath, 'utf8'));
  const backupPath = firstRead.workflowMigration.backupPath;

  assert.equal(firstRead.orders['s:1'].workflowStatus, 工作流状态.发票已登记);
  assert.equal(firstRead.orders['s:1'].jdOnlyField, '必须保留');
  assert.equal(firstRead.orders['s:1'].invoiceReturnFilePath, 'D:\\invoice\\1.pdf');
  assert.equal(Object.hasOwn(stored.orders['s:1'], 'processing'), false);
  assert.equal(Object.hasOwn(stored.orders['s:1'], 'invoiceRegistered'), false);
  assert.equal(Object.hasOwn(stored.orders['s:1'], 'handled'), false);
  assert.equal(firstRead.archivedHandledOrders['s:old'].orderNumber, 'old');
  assert.equal(fs.existsSync(backupPath), true);
  assert.equal(setup.repository.读取订单数据().workflowMigration.backupPath, backupPath);
  assert.equal(fs.readdirSync(setup.backupRoot).length, 1);
});

test('重复同步按 key 去重并保留人工状态、备注、档案与回传凭证', () => {
  const setup = 创建测试仓库();
  setup.repository.同步订单记录([{
    key: 's:1', storeId: 's', storeName: 'A店', orderNumber: '1', platformStatus: { text: '待开票' }, rawValue: 'first',
  }]);
  setup.repository.转换订单状态('s:1', 工作流状态.处理中);
  setup.repository.更新订单记录('s:1', {
    noteText: '人工备注',
    contactName: '客户甲',
    orderNoteText: '长期档案',
    invoiceReturnFilePath: 'D:\\invoice\\1.pdf',
  });
  const result = setup.repository.同步订单记录([{
    key: 's:1', storeId: 's', storeName: 'A店新名称', orderNumber: '1', platformStatus: { text: '开票成功' }, noteText: '', rawValue: 'second',
  }]);

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].workflowStatus, 工作流状态.处理中);
  assert.equal(result.records[0].noteText, '人工备注');
  assert.equal(result.records[0].contactName, '客户甲');
  assert.equal(result.records[0].orderNoteText, '长期档案');
  assert.equal(result.records[0].invoiceReturnFilePath, 'D:\\invoice\\1.pdf');
  assert.equal(result.records[0].platformStatus.text, '开票成功');
  assert.equal(result.records[0].rawValue, 'second');
});

test('已处理归档订单再次同步不会复活，手动明确恢复才重新进入待处理', () => {
  const setup = 创建测试仓库();
  setup.repository.同步订单记录([{ key: 's:1', storeId: 's', orderNumber: '1' }]);
  setup.repository.转换订单状态('s:1', 工作流状态.处理中);
  setup.repository.转换订单状态('s:1', 工作流状态.发票已登记);
  setup.repository.转换订单状态('s:1', 工作流状态.已处理);
  const archived = setup.repository.归档已处理订单();
  const resync = setup.repository.同步订单记录([{ key: 's:1', storeId: 's', orderNumber: '1', summary: '再次出现' }]);

  assert.equal(archived.removedCount, 1);
  assert.equal(fs.existsSync(archived.backupPath), true);
  assert.equal(resync.records.length, 0);
  assert.equal(resync.skippedArchivedRecords.length, 1);

  const restored = setup.repository.同步订单记录(
    [{ key: 's:1', storeId: 's', orderNumber: '1' }],
    { allowArchivedRestore: true },
  );
  assert.equal(restored.records[0].workflowStatus, 工作流状态.待处理);
});

test('回传失败或跳过保留发票已登记，成功才自动进入已处理', () => {
  const setup = 创建测试仓库();
  setup.repository.同步订单记录([{ key: 's:1', storeId: 's', orderNumber: '1' }]);
  setup.repository.转换订单状态('s:1', 工作流状态.处理中);
  setup.repository.转换订单状态('s:1', 工作流状态.发票已登记);

  assert.equal(setup.repository.记录订单回传尝试('s:1', { status: 'skipped', message: '发票缺失' }).workflowStatus, 工作流状态.发票已登记);
  assert.equal(setup.repository.记录订单回传尝试('s:1', { status: 'error', message: '上传失败', screenshotPath: 'D:\\proof\\error.png' }).workflowStatus, 工作流状态.发票已登记);
  const success = setup.repository.记录订单回传尝试('s:1', { status: 'success', message: '回传成功', invoiceFilePath: 'D:\\invoice\\1.pdf' });
  assert.equal(success.workflowStatus, 工作流状态.已处理);
  assert.equal(success.lastReturnAttempt.status, 'success');
});

test('不同平台仓库使用不同文件，订单号相同也不会互相污染', () => {
  const first = 创建测试仓库('platform-a');
  const secondFile = path.join(first.root, 'platform-b.json');
  const second = 创建订单记录仓库({
    filePath: secondFile,
    buildMigrationBackupPath: (sourcePath) => `${sourcePath}.backup`,
  });
  first.repository.同步订单记录([{ key: 'same:1', storeId: 'same', orderNumber: '1', noteText: 'A' }]);
  second.同步订单记录([{ key: 'same:1', storeId: 'same', orderNumber: '1', noteText: 'B' }]);

  assert.equal(first.repository.记录转列表()[0].noteText, 'A');
  assert.equal(second.记录转列表()[0].noteText, 'B');
  assert.notEqual(first.filePath, secondFile);
});
