// 该文件用于验证京东巡检旧网页状态安全迁移、巡检明细持久化、四阶段流转及客户档案保留。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  读取订单数据,
  读取订单列表,
  同步巡检店铺结果,
  更新订单工作流状态,
  设置订单备注,
  设置订单客户档案,
} = require('../src/order/jdInspectionOrderStore');

function 创建临时状态文件() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-inspection-workflow-')), 'invoice-order-state.json');
}

function 写JSON(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function 构建店铺结果(countdownText = '还有 3 天逾期') {
  return {
    storeId: 'store-a',
    storeName: '京东A店',
    lastCheckedAt: '2026-08-07T01:00:00.000Z',
    records: [{
      id: 'record-1',
      source: '页面表格',
      summary: `订单待登记 ${countdownText}`,
      fields: {
        销售订单编号: 'A-1001',
        发票上传倒计时: countdownText,
        客户名称: '测试客户',
      },
    }],
  };
}

test('旧网页状态先备份迁移，备注与客户档案完整保留且不再保存旧 status', () => {
  const file = 创建临时状态文件();
  const key = 'store-a::record-1';
  写JSON(file, {
    version: 1,
    orders: {
      [key]: {
        orderKey: key,
        status: 'processing',
        noteText: '本次联系记录',
        contactName: '张三',
        orderNoteText: '重点客户',
        updatedAt: 1720000000000,
      },
    },
  });

  const data = 读取订单数据(file);
  const order = data.orders[key];
  assert.equal(order.workflowStatus, 'processing');
  assert.equal(Object.hasOwn(order, 'status'), false);
  assert.equal(order.noteText, '本次联系记录');
  assert.equal(order.contactName, '张三');
  assert.equal(order.orderNoteText, '重点客户');
  assert.equal(fs.existsSync(data.workflowMigration.backupPath), true);
  assert.equal(JSON.parse(fs.readFileSync(data.workflowMigration.backupPath, 'utf8')).version, 1);
});

test('巡检只新增需要人工登记的明细，并持久保存订单号与平台状态', () => {
  const file = 创建临时状态文件();
  const result = 同步巡检店铺结果(构建店铺结果(), file);
  assert.equal(result.addedRecords.length, 1);
  const order = 读取订单列表(file)[0];
  assert.equal(order.key, 'store-a::record-1');
  assert.equal(order.orderNumber, 'A-1001');
  assert.equal(order.workflowStatus, 'pending');
  assert.equal(order.platformStatus.kind, 'needs_registration');
  assert.equal(order.platformStatus.text, '待登记即将逾期');

  const cleanFile = 创建临时状态文件();
  const clean = 同步巡检店铺结果(构建店铺结果('未逾期'), cleanFile);
  assert.equal(clean.addedRecords.length, 0);
  assert.equal(读取订单列表(cleanFile).length, 0);
});

test('人工阶段、备注和客户档案在重新巡检后保持，平台事实独立更新', () => {
  const file = 创建临时状态文件();
  const first = 同步巡检店铺结果(构建店铺结果(), file);
  const key = first.addedRecords[0].key;
  更新订单工作流状态(key, 'processing', file);
  更新订单工作流状态(key, 'invoice_registered', file);
  设置订单备注(key, '已电话联系', file);
  设置订单客户档案(key, { contactName: '李四', orderNoteText: '长期跟进客户' }, file);

  同步巡检店铺结果(构建店铺结果('未逾期'), file);
  const order = 读取订单列表(file)[0];
  assert.equal(order.workflowStatus, 'invoice_registered');
  assert.equal(order.noteText, '已电话联系');
  assert.equal(order.contactName, '李四');
  assert.equal(order.orderNoteText, '长期跟进客户');
  assert.equal(order.platformStatus.text, '已上传未逾期');
});

test('四阶段合法流转包含新增的发票已登记队列', () => {
  const file = 创建临时状态文件();
  const key = 同步巡检店铺结果(构建店铺结果(), file).addedRecords[0].key;
  assert.equal(更新订单工作流状态(key, 'processing', file).workflowStatus, 'processing');
  assert.equal(更新订单工作流状态(key, 'invoice_registered', file).workflowStatus, 'invoice_registered');
  assert.equal(更新订单工作流状态(key, 'handled', file).workflowStatus, 'handled');
  assert.equal(更新订单工作流状态(key, 'invoice_registered', file).workflowStatus, 'invoice_registered');
});
