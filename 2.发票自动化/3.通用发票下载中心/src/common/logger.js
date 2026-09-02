const fs = require('fs');
const path = require('path');
const { 本次日志文件路径 } = require('./paths');

let 日志文件已初始化 = false;

function 是测试模式() {
  // 这个函数解决测试时不污染真实运行日志的问题。
  return process.env.INVOICE_DOWNLOAD_CENTER_TEST_MODE === '1';
}

function 是否隐藏终端日志() {
  // 这个函数解决命令行界面运行时后台日志插入当前页面的问题。
  return process.env.INVOICE_DOWNLOAD_CENTER_SUPPRESS_CONSOLE_LOG === '1';
}

function 格式化时间(date = new Date()) {
  // 这个函数解决日志时间格式统一的问题。
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function 解析调用位置() {
  // 这个函数解决日志能回溯到具体文件和行号的问题。
  const stack = new Error().stack?.split('\n') || [];
  const 调用行 = stack.find((line, index) => index >= 2 && line.includes(path.sep)) || '';
  const 匹配结果 = 调用行.match(/\(?(.+):(\d+):(\d+)\)?$/);
  return {
    文件名: 匹配结果 ? path.basename(匹配结果[1]) : 'unknown',
    行号: 匹配结果 ? 匹配结果[2] : '0',
  };
}

function 确保日志文件已初始化() {
  // 这个函数解决每次运行只保留一个最新日志文件的问题。
  if (是测试模式() || 日志文件已初始化) return;
  fs.mkdirSync(path.dirname(本次日志文件路径), { recursive: true });
  fs.writeFileSync(本次日志文件路径, '', 'utf8');
  日志文件已初始化 = true;
}

function 打印日志(主线动作, 模块名, 子动作 = '') {
  // 这个函数解决终端和本地日志格式统一的问题。
  const { 文件名, 行号 } = 解析调用位置();
  const 子动作片段 = 子动作 ? `[${子动作}]` : '';
  const 日志行 = `[${格式化时间()}][${文件名}:${行号}][主线:${主线动作}][${模块名}]${子动作片段}`;
  确保日志文件已初始化();
  if (!是否隐藏终端日志()) console.log(日志行);
  if (!是测试模式()) {
    fs.appendFileSync(本次日志文件路径, `${日志行}\n`, 'utf8');
  }
}

module.exports = {
  格式化时间,
  是否隐藏终端日志,
  打印日志,
};
