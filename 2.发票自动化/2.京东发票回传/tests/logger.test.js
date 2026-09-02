const test = require('node:test');
const assert = require('node:assert/strict');
const readline = require('readline');
const { 打印日志 } = require('../src/common/logger');

function 捕获终端输出(测试函数) {
  // 该函数模拟真实 TTY，验证原地刷新不会退化成多行刷屏。
  const 原始IsTTY描述 = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const 原始Write = process.stdout.write;
  const 原始ClearLine = readline.clearLine;
  const 原始CursorTo = readline.cursorTo;
  const 输出片段 = [];
  const 光标动作 = [];

  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  process.stdout.write = (chunk, encoding, callback) => {
    输出片段.push(String(chunk));
    if (typeof encoding === 'function') encoding();
    if (typeof callback === 'function') callback();
    return true;
  };
  readline.clearLine = (stream, direction) => {
    光标动作.push(`clear:${direction}`);
    return true;
  };
  readline.cursorTo = (stream, x) => {
    光标动作.push(`cursor:${x}`);
    return true;
  };

  try {
    测试函数({ 输出片段, 光标动作 });
  } finally {
    process.stdout.write = 原始Write;
    readline.clearLine = 原始ClearLine;
    readline.cursorTo = 原始CursorTo;
    if (原始IsTTY描述) {
      Object.defineProperty(process.stdout, 'isTTY', 原始IsTTY描述);
    } else {
      delete process.stdout.isTTY;
    }
  }
}

test('进度日志在真实终端里原地刷新，普通日志会另起一行', () => {
  捕获终端输出(({ 输出片段, 光标动作 }) => {
    打印日志('数据提取', '接口分页', '读取进度：[#####---------------] 25%', { 原地刷新: true });
    打印日志('数据提取', '接口分页', '读取进度：[##########----------] 50%', { 原地刷新: true });
    打印日志('数据提取', '接口分页', '接口读取完成：发票订单=100');

    assert.deepEqual(光标动作, ['clear:0', 'cursor:0', 'clear:0', 'cursor:0']);
    assert.equal(输出片段[0].includes('25%'), true);
    assert.equal(输出片段[1].includes('50%'), true);
    assert.equal(输出片段[2], '\n');
    assert.match(输出片段[3], /接口读取完成：发票订单=100]\n$/);
  });
});

test('CLI隔离期间原地刷新日志不再直写业务页面', () => {
  const 隔离标记 = Symbol.for('invoice-automation.cli-log-isolation');
  const 原始隔离标记 = globalThis[隔离标记];
  const 原始ConsoleLog = console.log;
  const 日志内容 = [];

  try {
    globalThis[隔离标记] = true;
    console.log = (line) => 日志内容.push(String(line));
    捕获终端输出(({ 输出片段, 光标动作 }) => {
      打印日志('数据提取', '接口分页', '读取进度：50%', { 原地刷新: true });

      assert.deepEqual(输出片段, []);
      assert.deepEqual(光标动作, []);
      assert.equal(日志内容.some((line) => line.includes('读取进度：50%')), true);
    });
  } finally {
    console.log = 原始ConsoleLog;
    if (原始隔离标记 === undefined) delete globalThis[隔离标记];
    else globalThis[隔离标记] = 原始隔离标记;
  }
});
