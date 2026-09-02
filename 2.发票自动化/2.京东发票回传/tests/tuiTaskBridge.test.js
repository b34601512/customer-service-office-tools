const test = require('node:test');
const assert = require('node:assert/strict');
const { 确认后台任务结果 } = require('../src/tui/startTui');

test('TUI 接受任务服务的真实完成消息', () => {
  const result = 确认后台任务结果({
    status: 'idle',
    message: '批量发票回传完成：成功 0/2 单，跳过 2 单。',
  });

  assert.match(result.message, /成功 0\/2 单，跳过 2 单/);
});

test('TUI 将任务服务失败继续向外抛出', () => {
  assert.throws(
    () => 确认后台任务结果({
      status: 'error',
      message: '任务失败：外层文案不得覆盖',
      errorMessage: '京东页面打开失败',
    }),
    /京东页面打开失败/,
  );
});
