const fs = require('fs');
const { EventEmitter } = require('events');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  构建打开文件夹命令,
  打开凭证目录,
} = require('../src/cli/evidenceViewer');

function 创建测试截图目录() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jd-invoice-return-evidence-'));
}

test('Windows 凭证查看直接打开统一截图文件夹', async () => {
  const 截图根目录 = 创建测试截图目录();
  try {
    const 调用记录 = [];
    const 模拟进程 = new EventEmitter();
    模拟进程.unref = () => {};

    const 打开后的文件夹路径 = await 打开凭证目录(截图根目录, {
      平台: 'win32',
      启动进程: (程序, 参数, 选项) => {
        调用记录.push({ 程序, 参数, 选项 });
        process.nextTick(() => 模拟进程.emit('spawn'));
        return 模拟进程;
      },
    });

    assert.equal(打开后的文件夹路径, path.resolve(截图根目录));
    assert.deepEqual(调用记录, [{
      程序: 'explorer.exe',
      参数: ['/n,', path.resolve(截图根目录)],
      选项: {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      },
    }]);
  } finally {
    fs.rmSync(截图根目录, { recursive: true, force: true });
  }
});

test('打开凭证文件夹启动失败时应该返回明确错误', async () => {
  const 截图根目录 = 创建测试截图目录();
  try {
    const 模拟进程 = new EventEmitter();
    process.nextTick(() => 模拟进程.emit('error', new Error('资源管理器不可用')));

    await assert.rejects(
      () => 打开凭证目录(截图根目录, {
        平台: 'win32',
        启动进程: () => 模拟进程,
      }),
      /打开凭证文件夹失败：资源管理器不可用/,
    );
  } finally {
    fs.rmSync(截图根目录, { recursive: true, force: true });
  }
});

test('不同系统的打开文件夹命令使用系统默认文件管理器', () => {
  assert.deepEqual(构建打开文件夹命令('/tmp/invoice-screenshots', 'darwin'), {
    程序: 'open',
    参数: ['/tmp/invoice-screenshots'],
    选项: {
      detached: true,
      stdio: 'ignore',
    },
  });
  assert.deepEqual(构建打开文件夹命令('/tmp/invoice-screenshots', 'linux'), {
    程序: 'xdg-open',
    参数: ['/tmp/invoice-screenshots'],
    选项: {
      detached: true,
      stdio: 'ignore',
    },
  });
});
