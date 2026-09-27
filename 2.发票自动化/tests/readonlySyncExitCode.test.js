// 反向断言：只读同步必须禁止静默等待。
// 2026-09-27 抖音店铺5 只读同步卡死 9 分钟无输出后加的单店墙钟上限，这里把规则锁死。
const assert = require('node:assert/strict');
const { 计算只读同步退出码, 限时执行, 单店墙钟上限毫秒 } = require('../.codex-temporary/readonly-sync');

assert.equal(计算只读同步退出码([{ 店铺: '店铺1', 状态: '成功' }]), 0);
assert.equal(计算只读同步退出码([{ 店铺: '店铺1', 状态: '失败：页面超时' }]), 1);
assert.equal(计算只读同步退出码(null), 1);

(async () => {
  // 默认上限必须是有限正数（不允许取消上限）。
  assert.ok(Number.isFinite(单店墙钟上限毫秒) && 单店墙钟上限毫秒 > 0);

  // 正常任务原样返回。
  assert.equal(await 限时执行(Promise.resolve('ok'), 1000, '测试任务'), 'ok');

  // 永不 settle 的任务必须被墙钟打成可见失败，而不是静默等待。
  const 永不结束 = new Promise(() => {});
  await assert.rejects(
    () => 限时执行(永不结束, 50, '测试任务'),
    /超过单店墙钟上限.*禁止静默等待/,
  );

  // 超时后内部任务再抛错，不允许升级成 unhandledRejection。
  const 未处理 = [];
  const 记录 = (错误) => 未处理.push(错误);
  process.on('unhandledRejection', 记录);
  let 内部拒绝 = null;
  const 稍后失败 = new Promise((_, 拒绝) => { 内部拒绝 = 拒绝; });
  await assert.rejects(() => 限时执行(稍后失败, 50, '测试任务'), /超过单店墙钟上限/);
  内部拒绝(new Error('超时后的内部错误'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  process.off('unhandledRejection', 记录);
  assert.equal(未处理.length, 0);

  console.log('readonlySyncStoreWallClock: 6 tests passed');
})().catch((错误) => {
  console.error(错误);
  process.exit(1);
});
