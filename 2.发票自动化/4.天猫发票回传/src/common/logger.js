const fs = require('fs');
const path = require('path');
const { 格式化时间 } = require('./time');
const { 本次日志文件路径 } = require('./paths');
const { 广播日志 } = require('./logHub');

let 日志文件已初始化 = false;

function 是测试模式() {
  // 解决：自动测试不写真实运行日志，避免污染人工排查记录。
  return process.env.TMALL_INVOICE_RETURN_TEST_MODE === '1';
}

function 确保本次日志文件已初始化() {
  // 解决：每次真实运行只保留一个 latest-run.log，避免历史日志越堆越多。
  if (是测试模式() || 日志文件已初始化) {
    return;
  }
  fs.mkdirSync(path.dirname(本次日志文件路径), { recursive: true });
  fs.writeFileSync(本次日志文件路径, '', 'utf8');
  日志文件已初始化 = true;
}

function 解析调用位置() {
  // 解决：日志直接带文件和行号，后续排查不用全文搜索。
  const stack = new Error().stack?.split('\n') ?? [];
  const 调用行 = stack.find((line, index) => index >= 2 && line.includes(path.sep)) ?? '';
  const 匹配结果 = 调用行.match(/\(?(.+):(\d+):(\d+)\)?$/);
  if (!匹配结果) {
    return { 文件名: 'unknown', 行号: '0' };
  }
  return { 文件名: path.basename(匹配结果[1]), 行号: 匹配结果[2] };
}

function 打印日志(主线动作, 模块名, 子动作 = '', 选项 = {}) {
  // 解决：按统一格式打印关键动作，控制噪声同时保留定位能力。
  const { 缩进 = 0 } = 选项;
  const { 文件名, 行号 } = 解析调用位置();
  const 前缀 = '  '.repeat(Math.max(0, 缩进));
  const 子动作片段 = 子动作 ? `[${子动作}]` : '';
  const 日志行 = `${前缀}[${格式化时间()}][${文件名}:${行号}][主线:${主线动作}][${模块名}]${子动作片段}`;
  确保本次日志文件已初始化();
  console.log(日志行);
  if (!是测试模式()) {
    fs.appendFileSync(本次日志文件路径, `${日志行}\n`, 'utf8');
  }
  广播日志(日志行);
}

module.exports = {
  打印日志,
};
