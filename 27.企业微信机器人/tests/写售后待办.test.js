const test = require('node:test');
const assert = require('node:assert');
const { 解析参数, 构造记录, SHEET, DOCID } = require('../scripts/写售后待办.cjs');

test('解析参数：默认优先级/负责人', () => {
  const r = 解析参数(['--content', '试试']);
  assert.equal(r.优先级, '一般');
  assert.equal(r.content, '试试');
  assert.throws(() => 解析参数([]), /缺少 --content/);
});

test('构造记录：字段齐全且负责人默认李守耀', () => {
  const rec = 构造记录({ content: '抖5 订单 123：处理一下', 优先级: '一般' }).values;
  assert.equal(rec.待办事项[0].text, '抖5 订单 123：处理一下');
  assert.equal(rec.是否完成, false);
  assert.match(rec.截止时间, /^\d{4}-\d{2}-\d{2} 00:00:00$/);
  assert.equal(rec.负责人[0].userName, '李守耀（售后组长）');
  assert.equal(rec.优先级[0].id, 'oonpZv');
});

test('构造记录：可指定负责人与截止时间', () => {
  const rec = 构造记录({ content: 'x', ownerId: 'u1', ownerName: '张三', deadline: '2026-10-01 00:00:00' }).values;
  assert.deepEqual(rec.负责人, [{ userId: 'u1', userName: '张三' }]);
  assert.equal(rec.截止时间, '2026-10-01 00:00:00');
});

test('常量：目标表就是「金牌组待办清单」的售后待办清单', () => {
  assert.equal(SHEET, '售后待办清单');
  assert.ok(DOCID.startsWith('s3_'));
});

test('挑选值班负责人：从排班名单里挑认识的（不猜）', () => {
  const { 挑选值班负责人 } = require('../scripts/写售后待办.cjs');
  assert.equal(挑选值班负责人(['柯紫婷', '邓远祥']).userName, '柯紫婷（售后客服）');
  assert.equal(挑选值班负责人(['李守耀', '柯紫婷']).userName, '李守耀（售后组长）');
  assert.equal(挑选值班负责人(['徐佳楠', '麦诺谦']), null);
  assert.equal(挑选值班负责人([]), null);
  assert.equal(挑选值班负责人(undefined), null);
});
