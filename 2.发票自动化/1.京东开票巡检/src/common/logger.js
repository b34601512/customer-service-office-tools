const path = require('path');
const { 格式化时间 } = require('./time');
const { 广播日志 } = require('./logHub');

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

function 打印日志(主线动作, 模块名, 子动作 = '', 选项 = {}) {
  // 解决：按统一格式输出中文日志，方便你直接从终端定位问题。
  const { 缩进 = 0 } = 选项;
  const { 文件名, 行号 } = 解析调用位置();
  const 前缀 = '  '.repeat(Math.max(0, 缩进));
  const 时间 = 格式化时间();
  const 子动作片段 = 子动作 ? `[${子动作}]` : '';
  const 日志行 = `${前缀}[${时间}][${文件名}:${行号}][主线:${主线动作}][${模块名}]${子动作片段}`;
  console.log(日志行);
  广播日志(日志行);
}

module.exports = {
  打印日志,
};
