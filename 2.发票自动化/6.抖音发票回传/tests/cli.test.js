const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function 读取项目文件(相对路径) {
  return fs.readFileSync(path.join(__dirname, '..', 相对路径), 'utf8');
}

test('CLI首页提供一键发票回传和凭证入口', () => {
  const text = 读取项目文件('src/cli/startCli.js');

  assert.match(text, /\.\/evidenceViewer/);
  assert.match(text, /标题: '凭证查看'/);
  assert.match(text, /编号: '6', 名称: '发票回传（自动同步并回传）'/);
  assert.match(text, /编号: '7', 名称: '打开凭证文件夹'/);
  assert.doesNotMatch(text, /同步待处理订单|订单状态管理|正式回传待回传订单/);
  assert.match(text, /platformReturnWorkbench/);
  assert.doesNotMatch(text, /试跑/);
});

test('启动入口和业务模块不再暴露试跑模式', () => {
  const packageJson = JSON.parse(读取项目文件('package.json'));

  assert.doesNotMatch(读取项目文件('src/main.js'), /试跑|return-dry-run/);
  assert.doesNotMatch(读取项目文件('src/app/returnInvoiceToDouyin.js'), /试跑/);
  assert.equal(packageJson.scripts['return:dry-run'], undefined);
});

test('CLI凭证查看模块可以加载', () => {
  const evidenceViewer = require('../src/cli/evidenceViewer');

  assert.equal(typeof evidenceViewer.打开凭证目录, 'function');
});

test('CLI把独立运行日志通道传给共享回传工作台', () => {
  const text = 读取项目文件('src/cli/startCli.js');

  assert.match(text, /发票回传\(\{ 提问器, 输出, 终端, 记录运行日志 \}\)/);
  assert.match(text, /回传工作台\.一键发票回传\(\{ 提问器, 输出, 终端, 记录运行日志 \}\)/);
});
