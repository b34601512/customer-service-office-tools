const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

test('黑窗启动器直接调用 TUI 入口', () => {
  // 该测试只校验 bat 启动链路配置，不真实启动程序，避免测试过程等待输入。
  const launcherPath = path.join(projectRoot, '启动下载中心.bat');
  const script = fs.readFileSync(launcherPath, 'utf8');
  assert.match(script, /runtime\\node\\node\.exe/);
  assert.match(script, /src\\tui\\startTui\.js/);
  assert.match(script, /runtime\\latest-run\.log/);
});
