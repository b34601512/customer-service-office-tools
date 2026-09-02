const test = require('node:test');
const assert = require('node:assert/strict');

const { 获取Npm安装命令 } = require('../src/app/ensureProjectDependencies');

test('Windows 下依赖安装必须通过 cmd.exe 启动 npm', () => {
  const npm安装命令 = 获取Npm安装命令();

  if (process.platform === 'win32') {
    assert.equal(npm安装命令.命令, 'cmd.exe');
    assert.deepEqual(npm安装命令.参数, ['/d', '/s', '/c', 'npm install']);
    return;
  }

  assert.equal(npm安装命令.命令, 'npm');
  assert.deepEqual(npm安装命令.参数, ['install']);
});
