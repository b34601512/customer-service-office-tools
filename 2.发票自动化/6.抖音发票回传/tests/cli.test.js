const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function 读取项目文件(相对路径) {
  return fs.readFileSync(path.join(__dirname, '..', 相对路径), 'utf8');
}

test('CLI首页提供一键发票回传，且不再提供已废弃的凭证入口', () => {
  const text = 读取项目文件('src/cli/startCli.js');

  assert.doesNotMatch(text, /\.\/evidenceViewer/);
  assert.doesNotMatch(text, /标题: '凭证查看'/);
  assert.doesNotMatch(text, /打开凭证文件夹/);
  assert.match(text, /编号: '6', 名称: '发票回传（自动同步并回传）'/);
  assert.doesNotMatch(text, /同步待处理订单|订单状态管理|正式回传待回传订单/);
  assert.match(text, /processStores/);
  assert.doesNotMatch(text, /platformReturnWorkbench/);
  assert.doesNotMatch(text, /试跑/);
});

test('启动入口和业务模块不再暴露试跑模式', () => {
  const packageJson = JSON.parse(读取项目文件('package.json'));

  assert.doesNotMatch(读取项目文件('src/main.js'), /试跑|return-dry-run/);
  assert.doesNotMatch(读取项目文件('src/app/returnInvoiceToDouyin.js'), /试跑/);
  assert.equal(packageJson.scripts['return:dry-run'], undefined);
});

test('CLI凭证查看模块已随截图能力一并删除', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src/cli/evidenceViewer.js')), false);
});

test('CLI和TUI共用逐店业务入口，删除旧两轮工作台', () => {
  const text = 读取项目文件('src/cli/startCli.js');

  assert.match(text, /发票回传\(\{ 提问器, 输出, 终端, 记录运行日志 \}\)/);
  assert.match(text, /await 逐店同步并回传\(/);
  assert.match(text, /记录运行日志\(progress.message\)/);
  const tui = 读取项目文件('src/tui/startTui.js');
  assert.match(tui, /await 逐店同步并回传\(/);
  assert.doesNotMatch(tui, /工作台上下文|platformReturnWorkbench|回传工作台/);
});
