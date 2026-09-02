// 该文件用于验证共享人工订单状态只有一份真源，并覆盖全部前进、回退和非法转换。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  工作流状态,
  从旧记录推断工作流状态,
  转换订单工作流状态,
  获取订单统计,
  筛选订单,
  读取平台状态,
  是发票已登记待回传订单,
  是平台待开票待回传订单,
} = require('./orderWorkflow');

test('旧京东布尔状态按已处理优先级迁移为唯一 workflowStatus', () => {
  assert.equal(从旧记录推断工作流状态({ processing: true }), 工作流状态.处理中);
  assert.equal(从旧记录推断工作流状态({ processing: true, invoiceRegistered: true }), 工作流状态.发票已登记);
  assert.equal(从旧记录推断工作流状态({ processing: true, invoiceRegistered: true, handled: true }), 工作流状态.已处理);
  assert.equal(从旧记录推断工作流状态({ status: 'pending' }), 工作流状态.待处理);
});

test('四阶段覆盖全部允许的前进和单步回退', () => {
  const pending = { key: 's:1', workflowStatus: 工作流状态.待处理 };
  const processing = 转换订单工作流状态(pending, 工作流状态.处理中, '2026-08-07T01:00:00.000Z');
  const registered = 转换订单工作流状态(processing, 工作流状态.发票已登记, '2026-08-07T02:00:00.000Z');
  const handled = 转换订单工作流状态(registered, 工作流状态.已处理, '2026-08-07T03:00:00.000Z');

  assert.equal(processing.workflowStatus, 工作流状态.处理中);
  assert.equal(registered.workflowStatus, 工作流状态.发票已登记);
  assert.equal(handled.workflowStatus, 工作流状态.已处理);
  assert.equal(转换订单工作流状态(handled, 工作流状态.发票已登记).workflowStatus, 工作流状态.发票已登记);
  assert.equal(转换订单工作流状态(registered, 工作流状态.处理中).workflowStatus, 工作流状态.处理中);
  assert.equal(转换订单工作流状态(processing, 工作流状态.待处理).workflowStatus, 工作流状态.待处理);
  assert.equal(转换订单工作流状态(processing, 工作流状态.已处理).workflowStatus, 工作流状态.已处理);
});

test('非法跨阶段转换直接抛中文原因', () => {
  assert.throws(
    () => 转换订单工作流状态({ workflowStatus: 工作流状态.待处理 }, 工作流状态.已处理),
    /不能从“待处理”直接改为“已处理”/,
  );
  assert.throws(
    () => 转换订单工作流状态({ workflowStatus: 'unknown' }, 工作流状态.处理中),
    /人工阶段无效/,
  );
});

test('统计和筛选按单一字段计算，每条订单只属于一个队列', () => {
  const orders = Object.values(工作流状态).map((workflowStatus, index) => ({ key: `s:${index}`, workflowStatus }));
  assert.deepEqual(获取订单统计(orders), {
    total: 4,
    pending: 1,
    processing: 1,
    invoiceRegistered: 1,
    invoice_registered: 1,
    handled: 1,
  });
  assert.equal(筛选订单(orders, 'pending').length, 1);
  assert.equal(筛选订单(orders, 'processing').length, 1);
  assert.equal(筛选订单(orders, 'invoiceRegistered').length, 1);
  assert.equal(筛选订单(orders, 'handled').length, 1);
});

test('平台后台状态和回传结果不推导人工阶段', () => {
  const order = {
    workflowStatus: 工作流状态.发票已登记,
    platformStatus: { kind: 'success', text: '平台开票成功' },
    lastReturnAttempt: { status: 'error', message: '上传失败' },
  };
  assert.deepEqual(读取平台状态(order), { kind: 'success', text: '平台开票成功' });
  assert.equal(是发票已登记待回传订单(order), true);
  assert.equal(是发票已登记待回传订单({ ...order, lastReturnAttempt: { status: 'success' } }), false);
});

test('待开票回传只看平台开票状态，不要求本地人工登记', () => {
  const 待开票订单 = {
    workflowStatus: 工作流状态.处理中,
    invoiceStatusKind: 'pending',
    invoiceStatusText: '待开票',
    lastReturnAttempt: { status: 'error', message: '上传失败' },
  };
  assert.equal(是平台待开票待回传订单(待开票订单), true);
  assert.equal(是平台待开票待回传订单({ ...待开票订单, platformStatus: { kind: 'pending', text: '待开票' } }), true);
  assert.equal(是平台待开票待回传订单({ ...待开票订单, lastReturnAttempt: { status: 'success' } }), false);
  assert.equal(是平台待开票待回传订单({ ...待开票订单, invoiceReturned: true }), false);
  assert.equal(是平台待开票待回传订单({ ...待开票订单, invoiceStatusKind: 'success' }), false);
  assert.equal(是平台待开票待回传订单({ ...待开票订单, invoiceStatusKind: '' }), false);
});
