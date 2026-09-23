const assert = require('node:assert/strict');
const { 计算只读同步退出码 } = require('../.codex-temporary/readonly-sync');

assert.equal(计算只读同步退出码([{ 店铺: '店铺1', 状态: '成功' }]), 0);
assert.equal(计算只读同步退出码([{ 店铺: '店铺1', 状态: '失败：页面超时' }]), 1);
assert.equal(计算只读同步退出码(null), 1);

console.log('readonlySyncExitCode: 3 tests passed');
