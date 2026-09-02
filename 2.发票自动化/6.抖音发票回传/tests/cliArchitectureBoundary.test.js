// 该文件用于防止抖音回传重新引入已迁出的网页控制台，并锁定 CLI 与通用清理边界。

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { 构建启动清理路径列表 } = require('../src/common/runtimeCleanup/startupAutoCleanup');

const 项目根目录 = path.resolve(__dirname, '..');
const 旧控制台文件列表 = [
  'src/controlCenter/controlCenterCleanupWatchdog.js',
  'src/controlCenter/controlCenterServer.js',
  'src/controlCenter/controlCenterState.js',
  'src/controlCenter/controlCenterWindowHub.js',
  'src/controlCenter/controlCenterWindowLifecycleMonitor.js',
  'src/controlCenter/processTree.js',
  'src/controlCenter/startControlCenter.js',
  'src/controlCenter/taskService.js',
  'src/controlCenter/web/app.js',
  'src/controlCenter/web/configDialog.js',
  'src/controlCenter/web/configFeedbackState.js',
  'src/controlCenter/web/index.html',
  'src/controlCenter/web/storeDraftState.js',
  'src/controlCenter/web/style.css',
];

旧控制台文件列表.forEach((相对路径) => {
  test(`CLI架构边界：旧控制台源码已迁出 ${相对路径}`, () => {
    assert.equal(fs.existsSync(path.join(项目根目录, 相对路径)), false);
  });
});

test('CLI架构边界：旧 controlCenter 目录整体不存在', () => {
  assert.equal(fs.existsSync(path.join(项目根目录, 'src/controlCenter')), false);
});

test('CLI架构边界：旧网页测试已随实现迁出', () => {
  [
    'configFeedbackState.test.js',
    'controlCenterCleanupWatchdog.test.js',
    'controlCenterServer.test.js',
    'controlCenterTaskServiceReport.test.js',
    'controlCenterWindowHub.test.js',
    'controlCenterWindowLifecycleMonitor.test.js',
    'storeDraftState.test.js',
  ].forEach((文件名) => {
    assert.equal(fs.existsSync(path.join(__dirname, 文件名)), false, `旧测试仍在项目内：${文件名}`);
  });
});

test('CLI架构边界：旧控制台运行目录不存在', () => {
  assert.equal(fs.existsSync(path.join(项目根目录, 'runtime/control-center-window')), false);
});

test('CLI架构边界：panel 脚本直接进入 TUI', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(项目根目录, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.panel, 'node src/tui/startTui.js');
});

test('CLI架构边界：start 脚本直接进入 TUI', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(项目根目录, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.start, 'node src/tui/startTui.js');
});

test('CLI架构边界：CLI 主入口文件保留', () => {
  assert.equal(fs.existsSync(path.join(项目根目录, 'src/cli/startCli.js')), true);
});

test('CLI架构边界：CLI 主入口不引用旧控制台', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/cli/startCli.js'), 'utf8');
  assert.doesNotMatch(文本, /controlCenter|startControlCenter/);
});

test('CLI架构边界：公共路径不再导出旧控制台目录', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/common/paths.js'), 'utf8');
  assert.doesNotMatch(文本, /控制台窗口目录|control-center-window/);
});

test('CLI架构边界：启动清理不再引用旧控制台目录', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/common/runtimeCleanup/startupAutoCleanup.js'), 'utf8');
  assert.doesNotMatch(文本, /控制台窗口目录|control-center-window/);
});

test('CLI架构边界：通用启动清理模块保留', () => {
  assert.equal(fs.existsSync(path.join(项目根目录, 'src/common/runtimeCleanup/startupAutoCleanup.js')), true);
});

test('CLI架构边界：通用清理执行器保留', () => {
  assert.equal(fs.existsSync(path.join(项目根目录, 'src/common/runtimeCleanup/cleanupRunner.js')), true);
});

test('CLI架构边界：通用路径迁移模块保留', () => {
  assert.equal(fs.existsSync(path.join(项目根目录, 'src/common/runtimeCleanup/pathMigration.js')), true);
});

test('CLI架构边界：通用备份路径模块保留', () => {
  assert.equal(fs.existsSync(path.join(项目根目录, 'src/common/runtimeCleanup/backupPath.js')), true);
});

test('CLI架构边界：店铺浏览器资料路径定义保留', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/common/paths.js'), 'utf8');
  assert.match(文本, /store-profiles/);
});

test('CLI架构边界：截图路径定义保留', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/common/paths.js'), 'utf8');
  assert.match(文本, /screenshots/);
});

test('CLI架构边界：启动清理排除店铺登录资料', () => {
  const 路径列表 = 构建启动清理路径列表(path.join(项目根目录, '边界测试'));
  assert.equal(路径列表.some((项目) => 项目.includes(path.join('runtime', 'store-profiles'))), false);
});

test('CLI架构边界：启动清理继续覆盖截图', () => {
  const 路径列表 = 构建启动清理路径列表(path.join(项目根目录, '边界测试'));
  assert.equal(路径列表.some((项目) => 项目.includes(path.join('runtime', 'screenshots'))), true);
});

test('CLI架构边界：启动清理继续覆盖抖音导出', () => {
  const 路径列表 = 构建启动清理路径列表(path.join(项目根目录, '边界测试'));
  assert.equal(路径列表.some((项目) => 项目.includes(path.join('runtime', 'douyin-exports'))), true);
});

test('CLI架构边界：启动清理继续覆盖全流程临时目录', () => {
  const 路径列表 = 构建启动清理路径列表(path.join(项目根目录, '边界测试'));
  assert.equal(路径列表.some((项目) => 项目.includes(path.join('runtime', 'full-flow'))), true);
});

test('CLI架构边界：登录命令继续使用业务入口', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(项目根目录, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.login, 'node src/main.js login');
});

test('CLI架构边界：采集命令继续使用业务入口', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(项目根目录, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.collect, 'node src/main.js collect');
});

test('CLI架构边界：包脚本不含旧控制台入口', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(项目根目录, 'package.json'), 'utf8'));
  assert.equal(Object.values(packageJson.scripts).some((命令) => /controlCenter|startControlCenter/.test(命令)), false);
});
