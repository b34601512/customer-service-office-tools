const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('下载中心 CLI 保持订单号到发票文件边界，不增加人工订单状态菜单', () => {
  const cliText = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'commandLineMenu.js'), 'utf8');
  assert.doesNotMatch(cliText, /订单状态管理|workflowStatus|共享订单状态/);
  assert.match(cliText, /批量下载发票|查看本地发票/);
});
