const assert = require('node:assert/strict');
const { assertSummaryCompleteBeforeKdocsSync } = require('../src/kdocsSync/summaryResultGuard');

assert.doesNotThrow(() => assertSummaryCompleteBeforeKdocsSync({
  status: 'success', successCount: 9, errorCount: 0, totalCount: 9, detail: '9家店成功'
}));
assert.throws(() => assertSummaryCompleteBeforeKdocsSync({
  status: 'partial_error', successCount: 5, errorCount: 4, totalCount: 9, detail: '4家店失败'
}), /已停止金山同步和透视筛选/);
assert.throws(() => assertSummaryCompleteBeforeKdocsSync(undefined), /未取得完整汇总结果/);

console.log('summaryResultGuard: 3 tests passed');
