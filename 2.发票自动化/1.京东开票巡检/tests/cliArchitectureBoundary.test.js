// 该文件用于防止京东巡检重新引入已迁出的网页控制台与兼容状态入口。

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const 项目根目录 = path.resolve(__dirname, '..');
const 仓库根目录 = path.resolve(项目根目录, '..');

const 旧控制台文件列表 = [
  'src/controlCenter/controlCenterCleanupWatchdog.js',
  'src/controlCenter/controlCenterResourceMonitor.js',
  'src/controlCenter/controlCenterServer.js',
  'src/controlCenter/controlCenterSingleInstance.js',
  'src/controlCenter/controlCenterState.js',
  'src/controlCenter/controlCenterWindowHub.js',
  'src/controlCenter/controlCenterWindowLifecycleMonitor.js',
  'src/controlCenter/processTree.js',
  'src/controlCenter/resourceMonitor/browserProcess.js',
  'src/controlCenter/resourceMonitor/byteFormatter.js',
  'src/controlCenter/resourceMonitor/constants.js',
  'src/controlCenter/resourceMonitor/pid.js',
  'src/controlCenter/resourceMonitor/processGroupBuilder.js',
  'src/controlCenter/resourceMonitor/processRole.js',
  'src/controlCenter/resourceMonitor/projectProcessFilter.js',
  'src/controlCenter/resourceMonitor/resourceUsageBuilder.js',
  'src/controlCenter/resourceMonitor/resourceUsageReader.js',
  'src/controlCenter/resourceMonitor/searchText.js',
  'src/controlCenter/resourceMonitor/windowsProcessSnapshot.js',
  'src/controlCenter/startControlCenter.js',
  'src/controlCenter/taskService.js',
  'src/controlCenter/web/app.js',
  'src/controlCenter/web/batchCompletionFeedback.js',
  'src/controlCenter/web/buttonFeedback.js',
  'src/controlCenter/web/config.html',
  'src/controlCenter/web/config.js',
  'src/controlCenter/web/configFeedbackState.js',
  'src/controlCenter/web/controlCenterShutdownHelper.js',
  'src/controlCenter/web/handled.html',
  'src/controlCenter/web/handled.js',
  'src/controlCenter/web/index.html',
  'src/controlCenter/web/invoiceAttentionState.js',
  'src/controlCenter/web/invoiceNoteDialog.css',
  'src/controlCenter/web/invoiceNoteDialog.js',
  'src/controlCenter/web/invoiceOrderCopy.js',
  'src/controlCenter/web/invoiceOrderState.js',
  'src/controlCenter/web/invoiceProfileDialog.js',
  'src/controlCenter/web/invoiceWorkflowUi.js',
  'src/controlCenter/web/logs.html',
  'src/controlCenter/web/logs.js',
  'src/controlCenter/web/storeDraftState.js',
  'src/controlCenter/web/style.css',
];

旧控制台文件列表.forEach((相对路径) => {
  test(`CLI架构边界：旧控制台源码已迁出 ${相对路径}`, () => {
    assert.equal(fs.existsSync(path.join(项目根目录, 相对路径)), false);
  });
});

test('CLI架构边界：批量摘要只保留在 CLI 目录', () => {
  assert.equal(fs.existsSync(path.join(项目根目录, 'src/controlCenter/batchInspectionSummary.js')), false);
  assert.equal(fs.existsSync(path.join(项目根目录, 'src/cli/batchInspectionSummary.js')), true);
});

test('CLI架构边界：旧 controlCenter 目录整体不存在', () => {
  assert.equal(fs.existsSync(path.join(项目根目录, 'src/controlCenter')), false);
});

test('CLI架构边界：旧网页与兼容测试已随实现迁出', () => {
  const 旧测试文件列表 = [
    'batchCompletionFeedback.test.js',
    'configFeedbackState.test.js',
    'controlCenterCleanupWatchdog.test.js',
    'controlCenterOrderWorkflowModal.test.js',
    'controlCenterResourceMonitor.test.js',
    'controlCenterResourceUsageUi.test.js',
    'controlCenterServerClipboard.test.js',
    'controlCenterShutdownHelper.test.js',
    'controlCenterSingleInstance.test.js',
    'controlCenterTaskService.test.js',
    'controlCenterWindowHub.test.js',
    'controlCenterWindowLifecycleMonitor.test.js',
    'invoiceAttentionState.test.js',
    'invoiceOrderCopy.test.js',
    'invoiceOrderState.test.js',
    'invoiceOrderStateService.test.js',
    'storeDraftState.test.js',
  ];
  旧测试文件列表.forEach((文件名) => {
    assert.equal(fs.existsSync(path.join(__dirname, 文件名)), false, `旧测试仍在项目内：${文件名}`);
  });
});

test('CLI架构边界：panel 脚本直接进入 TUI，panel:cli 进入 CLI', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(项目根目录, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.panel, 'node src/tui/startTui.js');
  assert.equal(packageJson.scripts['panel:cli'], 'node src/cli/startCli.js');
});

test('CLI架构边界：start 脚本直接进入 TUI', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(项目根目录, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.start, 'node src/tui/startTui.js');
});

test('CLI架构边界：TUI 页面存在且不依赖旧控制台', () => {
  const 入口文本 = fs.readFileSync(path.join(项目根目录, 'src/tui/startTui.js'), 'utf8');
  assert.match(入口文本, /创建总览页/);
  assert.match(入口文本, /创建日志页/);
  assert.doesNotMatch(入口文本, /controlCenter|startControlCenter/);
});

test('CLI架构边界：巡检总览从 CLI 同目录加载批量摘要', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/cli/inspectionOverview.js'), 'utf8');
  assert.match(文本, /require\('\.\/batchInspectionSummary'\)/);
  assert.doesNotMatch(文本, /controlCenter/);
});

test('CLI架构边界：CLI 主入口不再引用旧控制台', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/cli/startCli.js'), 'utf8');
  assert.doesNotMatch(文本, /controlCenter|startControlCenter/);
});

test('CLI架构边界：公共路径不再导出旧控制台运行目录', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/common/paths.js'), 'utf8');
  assert.doesNotMatch(文本, /控制台窗口目录|control-center-window/);
});

test('CLI架构边界：浏览器资料枚举不再包含旧控制台配置', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/runtime/browserProfile/profilePaths.js'), 'utf8');
  assert.doesNotMatch(文本, /controlCenterProfileDir|控制台窗口目录|control-center-window/);
});

test('CLI架构边界：便携包不再创建旧控制台目录', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/release/buildPortablePackage.js'), 'utf8');
  assert.doesNotMatch(文本, /control-center-window/);
});

test('CLI架构边界：便携包安全校验不再枚举旧控制台目录', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/release/packageSafetyGuard.js'), 'utf8');
  assert.doesNotMatch(文本, /control-center-window/);
});

test('CLI架构边界：客服分发包不再创建旧控制台目录', () => {
  const 文本 = fs.readFileSync(path.join(仓库根目录, '导出客服分发包.js'), 'utf8');
  assert.doesNotMatch(文本, /control-center-window/);
});

test('CLI架构边界：旧发票状态服务文件已迁出', () => {
  assert.equal(fs.existsSync(path.join(项目根目录, 'src/store/invoiceOrderStateService.js')), false);
});

test('CLI架构边界：订单仓库不再导出读取兼容处理状态', () => {
  const 文本 = fs.readFileSync(path.join(项目根目录, 'src/order/jdInspectionOrderStore.js'), 'utf8');
  assert.doesNotMatch(文本, /读取兼容处理状态/);
});

test('CLI架构边界：登录资料、业务数据和通用缓存治理均保留', () => {
  [
    'runtime/store-profiles',
    'runtime/edge-profile',
    'data',
    'src/runtime/browserProfile',
  ].forEach((相对路径) => {
    assert.equal(fs.existsSync(path.join(项目根目录, 相对路径)), true, `应保留路径缺失：${相对路径}`);
  });
});
