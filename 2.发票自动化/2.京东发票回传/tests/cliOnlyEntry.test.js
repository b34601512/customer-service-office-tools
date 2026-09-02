const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const 项目根目录 = path.resolve(__dirname, '..');

function 读取项目文件(相对路径) {
  return path.join(项目根目录, 相对路径);
}

test('项目只保留CLI管理入口，旧网页流程不在运行目录', () => {
  const 旧网页路径列表 = [
    'src/controlCenter/web',
    'src/controlCenter/controlCenterServer.js',
    'src/controlCenter/startControlCenter.js',
    'src/controlCenter/controlCenterWindowHub.js',
    'src/controlCenter/controlCenterWindowLifecycleMonitor.js',
    'src/controlCenter/controlCenterCleanupWatchdog.js',
    'src/controlCenter/processTree.js',
    'src/main.js',
    'src/common/runtimeCleanup/controlCenterCleanup.js',
  ];
  旧网页路径列表.forEach((相对路径) => {
    assert.equal(fs.existsSync(读取项目文件(相对路径)), false, `旧网页文件仍在项目内：${相对路径}`);
  });

  const packageJson = JSON.parse(fs.readFileSync(读取项目文件('package.json'), 'utf8'));
  assert.equal(packageJson.scripts.panel, 'node src/tui/startTui.js');
  assert.equal(packageJson.scripts.start, 'node src/tui/startTui.js');
  assert.equal(Object.hasOwn(packageJson.scripts, 'login'), false);
  assert.equal(Object.hasOwn(packageJson.scripts, 'check'), false);

  const 启动脚本 = fs.readFileSync(读取项目文件('启动催票后台.bat'), 'utf8');
  assert.match(启动脚本, /src\\tui\\startTui\.js/);
  assert.doesNotMatch(启动脚本, /startControlCenter|src\\main\.js/);
});
