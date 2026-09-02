const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { 格式化时间 } = require('./time');
const { 广播日志 } = require('./logHub');
const { 本次日志文件路径 } = require('./paths');

let 日志文件已初始化 = false;
let 终端原地刷新活跃 = false;
const CLI日志隔离标记 = Symbol.for('invoice-automation.cli-log-isolation');

function 是测试模式() {
  // 解决：自动测试必须和真实运行日志隔离，避免并发测试进程抢写 latest-run.log。
  return process.env.JD_INVOICE_URGE_TEST_MODE === '1';
}

function 确保本次日志文件已初始化() {
  // 解决：每次程序启动只保留一个最新运行日志，避免历史日志堆积干扰排查。
  if (是测试模式()) {
    return;
  }

  if (日志文件已初始化) {
    return;
  }

  fs.mkdirSync(path.dirname(本次日志文件路径), { recursive: true });
  fs.writeFileSync(本次日志文件路径, '', 'utf8');
  日志文件已初始化 = true;
}

function 解析调用位置() {
  // 解决：从调用栈里提取真实文件和行号，保证日志能直接回溯代码。
  const stack = new Error().stack?.split('\n') ?? [];
  const 调用行 = stack.find((line, index) => index >= 2 && line.includes(path.sep)) ?? '';
  const 匹配结果 = 调用行.match(/\(?(.+):(\d+):(\d+)\)?$/);

  if (!匹配结果) {
    return {
      文件名: 'unknown',
      行号: '0',
    };
  }

  return {
    文件名: path.basename(匹配结果[1]),
    行号: 匹配结果[2],
  };
}

function 终端支持原地刷新() {
  // 解决：只有真实交互终端才使用光标控制，管道和测试输出继续保持普通文本。
  return Boolean(process.stdout && process.stdout.isTTY);
}

function 输出终端日志(日志行, 选项 = {}) {
  // 解决：高频进度日志用同一行刷新，普通日志自动另起一行，避免终端刷屏。
  // CLI 页面启用隔离时必须走 console 通道，让共享核心收进独立日志页，不能直写 stdout 覆盖业务视图。
  if (globalThis[CLI日志隔离标记] === true) {
    终端原地刷新活跃 = false;
    console.log(日志行);
    return;
  }
  if (选项.原地刷新 && 终端支持原地刷新()) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(日志行);
    终端原地刷新活跃 = true;
    return;
  }

  if (终端原地刷新活跃 && 终端支持原地刷新()) {
    process.stdout.write('\n');
  }
  终端原地刷新活跃 = false;
  console.log(日志行);
}

function 打印日志(主线动作, 模块名, 子动作 = '', 选项 = {}) {
  // 解决：按统一格式输出中文日志，方便你直接从终端定位问题。
  const { 缩进 = 0 } = 选项;
  const { 文件名, 行号 } = 解析调用位置();
  const 前缀 = '  '.repeat(Math.max(0, 缩进));
  const 时间 = 格式化时间();
  const 子动作片段 = 子动作 ? `[${子动作}]` : '';
  const 日志行 = `${前缀}[${时间}][${文件名}:${行号}][主线:${主线动作}][${模块名}]${子动作片段}`;
  确保本次日志文件已初始化();
  输出终端日志(日志行, 选项);
  if (!是测试模式()) {
    fs.appendFileSync(本次日志文件路径, `${日志行}\n`, 'utf8');
  }
  广播日志(日志行);
}

module.exports = {
  打印日志,
  解析调用位置,
};
