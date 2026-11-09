// 写售后待办.cjs 的单测：只验判定与正文（不读写表、不触网）。
// 跑：node --test "D:/桌面/木婉清/工具/售后待办/写售后待办.test.js"
// 锁的事：#779——「组长值班（底色 null）」不许被二次判定拒掉；真没人时仍硬报错。
const test = require('node:test');
const assert = require('node:assert');
const { 读此刻值班, 派单说明 } = require('./写售后待办.cjs');

const 配置 = {
  分组名单: {
    售后: {
      李某某: { userId: 'u-李某某', userName: '李某某（售后组长）' },
      柯某某: { userId: 'u-柯某某', userName: '柯某某（售后客服）' },
    },
  },
  颜色分组: { '#BDD7EE': '售后' },
  组长: { 售后: '李某某' },
};
// 组长没有底色、也不在「当日有色人员」里 —— 正是 #779 的病根场景
const 报告 = {
  当日有色人员: [{ 姓名: '柯某某', 底色: '#BDD7EE', 班次: '晚班' }],
  当日班次映射: { 李某某: { employeeName: '李某某', normalizedShift: '早班', backgroundColor: '' } },
};

test('组长在班（底色 null）：判得出组长，不再被二次判定拒掉', () => {
  const r = 读此刻值班({ 配置, 报告, 当前时间: new Date('2026-11-08T09:00:00') });
  assert.equal(r.found, true);
  assert.equal(r.userName, '李某某（售后组长）');
  assert.equal(r.userId, 'u-李某某');
  assert.equal(r.底色, null);
  assert.match(r.理由, /组长/);
});

test('带底色值班人在班：判得出那个人', () => {
  const r = 读此刻值班({ 配置, 报告, 当前时间: new Date('2026-11-08T19:30:00') });
  assert.equal(r.found, true);
  assert.equal(r.userId, 'u-柯某某');
  assert.equal(r.底色, '#BDD7EE');
});

test('真没人此刻在班：硬报错，不返回兜底人', () => {
  assert.throws(
    () => 读此刻值班({ 配置, 报告, 当前时间: new Date('2026-11-08T23:30:00') }),
    /挑不到唯一售后值班人/
  );
});

test('派单说明：组长与普通值班各一句，都说得出依据', () => {
  assert.match(派单说明('李某某（售后组长）', '值班（组长在班）'), /组长值班/);
  assert.match(派单说明('柯某某（售后客服）', '值班（排班表此刻在班）'), /此刻在岗值班/);
});
