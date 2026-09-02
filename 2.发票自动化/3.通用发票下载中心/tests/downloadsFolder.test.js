const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  构建打开文件夹命令,
  打开下载文件夹,
} = require('../src/server/downloadsFolder');

test('Windows 打开下载文件夹使用可见资源管理器窗口', () => {
  const command = 构建打开文件夹命令('D:\\发票下载', 'win32');
  assert.equal(command.command, 'explorer.exe');
  assert.deepEqual(command.args, ['/n,', 'D:\\发票下载']);
  assert.equal(command.options.detached, true);
  assert.equal(command.options.windowsHide, false);
});

test('打开下载文件夹会等待系统确认启动', async () => {
  let captured = null;
  let unrefCalled = false;
  const result = await 打开下载文件夹({
    platform: 'win32',
    spawnProcess: (command, args, options) => {
      // 该替身用于验证打开命令成功发起，不真实拉起资源管理器。
      captured = { command, args, options };
      const child = new EventEmitter();
      child.unref = () => {
        unrefCalled = true;
      };
      process.nextTick(() => child.emit('spawn'));
      return child;
    },
  });
  assert.match(result, /downloads/);
  assert.equal(captured.command, 'explorer.exe');
  assert.equal(captured.options.windowsHide, false);
  assert.equal(unrefCalled, true);
});
