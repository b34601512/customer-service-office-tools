const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const 项目根目录 = path.resolve(__dirname, '..');

function 读取项目文本文件(相对路径) {
  // 该函数用于按文件 BOM 读取启动器源码，避免 Windows 启动脚本编码差异影响断言。
  const 文件内容 = fs.readFileSync(path.join(项目根目录, 相对路径));
  if (文件内容[0] === 0xff && 文件内容[1] === 0xfe) {
    return 文件内容.toString('utf16le').replace(/^\uFEFF/, '');
  }

  if (文件内容[0] === 0xef && 文件内容[1] === 0xbb && 文件内容[2] === 0xbf) {
    return 文件内容.toString('utf8').replace(/^\uFEFF/, '');
  }

  return 文件内容.toString('utf8');
}

test('BAT 入口是当前唯一启动入口', () => {
  const bat路径 = path.join(项目根目录, '启动催票后台.bat');
  const vbs路径 = path.join(项目根目录, '启动中心.vbs');

  assert.equal(fs.existsSync(bat路径), true);
  assert.equal(fs.existsSync(vbs路径), false);
});

test('BAT 入口启动当前项目 CLI 链路', () => {
  const bat源码 = 读取项目文本文件('启动催票后台.bat');

  assert.match(bat源码, /chcp 65001>nul/);
  assert.match(bat源码, /runtime\\node\\node\.exe/);
  assert.match(bat源码, /src\\app\\ensureProjectDependencies\.js/);
  assert.match(bat源码, /src\\tui\\startTui\.js/);
  assert.doesNotMatch(bat源码, /启动中心\.vbs|hidden-launcher\.ps1/);
});
