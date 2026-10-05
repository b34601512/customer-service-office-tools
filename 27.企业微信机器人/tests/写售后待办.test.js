const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { 解析参数, 构造记录, 读表配置, SHEET, DOCID } = require('../scripts/写售后待办.cjs');

test('解析参数：默认优先级/负责人', () => {
  const r = 解析参数(['--content', '试试']);
  assert.equal(r.优先级, '一般');
  assert.equal(r.content, '试试');
  assert.throws(() => 解析参数([]), /缺少 --content/);
});

test('构造记录：字段齐全且负责人默认李某某', () => {
  const rec = 构造记录({ content: '抖5 订单 123：处理一下', 优先级: '一般' }).values;
  assert.equal(rec.待办事项[0].text, '抖5 订单 123：处理一下');
  assert.equal(rec.是否完成, false);
  assert.match(rec.截止时间, /^\d{4}-\d{2}-\d{2} 00:00:00$/);
  assert.equal(rec.负责人[0].userName, '李某某（售后组长）');
  assert.equal(rec.优先级[0].id, 'oonpZv');
});

test('构造记录：可指定负责人与截止时间', () => {
  const rec = 构造记录({ content: 'x', ownerId: 'u1', ownerName: '张三', deadline: '2026-10-01 00:00:00' }).values;
  assert.deepEqual(rec.负责人, [{ userId: 'u1', userName: '张三' }]);
  assert.equal(rec.截止时间, '2026-10-01 00:00:00');
});

test('常量：目标表就是「金牌组待办清单」的售后待办清单', () => {
  assert.equal(SHEET, '售后待办清单');
  // docid 是公司私有数据，不许写回代码（2026-09-30 用户要求打码）：只从本机配置/环境变量读
  if (DOCID) assert.ok(DOCID.startsWith('s3_'));
});

test('读表配置：环境变量优先；没有本机配置就报错（不内置 docid）', () => {
  assert.equal(读表配置({ WECOM_售后待办DOCID: 's3_TEST' }).docid, 's3_TEST');
  assert.equal(读表配置({ WECOM_售后待办DOCID: 's3_TEST' }).sheet, '售后待办清单');
  assert.equal(读表配置({ WECOM_售后待办DOCID: 's3_TEST', WECOM_售后待办SHEET: '别的子表' }).sheet, '别的子表');
  assert.throws(() => 读表配置({}, path.join(__dirname, '不存在的配置.local.json')), /docid/);
});

test('反向断言：脚本源码里不许再出现真实 docid（防止打码被改回去）', () => {
  const 源 = fs.readFileSync(path.join(__dirname, '..', 'scripts', '写售后待办.cjs'), 'utf8');
  assert.ok(!/s3_[A-Za-z0-9]{20,}/.test(源), '脚本里出现了 s3_ 开头的 docid，应改为从本机配置读');
});

const 假配置 = {
  颜色分组: { '#BDD7EE': '售后' },
  分组名单: {
    售后: {
      柯某某: { userId: 'u-ke', userName: '柯某某（售后客服）' },
      邓某某: { userId: 'u-deng', userName: '邓某某（售后客服）' },
    },
  },
};

test('挑选值班负责人：按底色＋此时此刻在班挑唯一的售后值班（分不清/不在班/没底色→null，不猜）', () => {
  const { 挑选值班负责人 } = require('../scripts/写售后待办.cjs');
  const 晚 = { 当前时间: new Date('2026-10-05T20:00:00') };
  const 晨 = { 当前时间: new Date('2026-10-05T09:25:00') };
  assert.equal(挑选值班负责人([{ 姓名: '邓某某', 底色: '#BDD7EE', 班次: '晚班' }], 假配置, 晚).userName, '邓某某（售后客服）');
  assert.equal(挑选值班负责人([{ 姓名: '柯某某', 底色: '#BDD7EE', 班次: '早班' }, { 姓名: '邓某某', 底色: '#BDD7EE', 班次: '早班' }], 假配置, 晚), null);
  assert.equal(挑选值班负责人([{ 姓名: '邓某某', 底色: '#BDD7EE', 班次: '晚班' }], 假配置, 晨), null); // 10-05 实况：晚班此刻不在岗
  assert.equal(挑选值班负责人(['徐某某', '麦某某'], 假配置, 晚), null);
  assert.equal(挑选值班负责人([], 假配置), null);
  assert.equal(挑选值班负责人(undefined, 假配置), null);
});

test('口径单一（反向锁）：27号 不许再自带排班链接/值班名单，必须走 28号', () => {
  const path = require('path');
  const fs = require('fs');
  const 源码 = fs.readFileSync(path.join(__dirname, '..', 'scripts', '写售后待办.cjs'), 'utf8');
  const mod = require('../scripts/写售后待办.cjs');
  assert.ok(源码.includes('28.排班与派活'), '必须引用 28号 的值班库');
  assert.equal(mod.值班人员表, undefined, '旧的本项目值班名单要删干净');
  assert.equal(mod.从report取有色姓名, undefined, '旧的读 report 逻辑要删干净');
  assert.ok(!/kdocs\.cn\/l\//.test(源码), '排班表链接只能放在 28号 配置里');
});
