const fs = require('fs');
const path = require('path');
const { 格式化时间 } = require('./time');
const { 诊断日志文件路径 } = require('./paths');

function 是测试模式() {
  // 解决：自动测试不能写真实诊断日志，避免污染用户本机运行证据。
  return process.env.TMALL_INVOICE_RETURN_TEST_MODE === '1';
}

function 解析调用位置() {
  // 解决：诊断日志要能反查触发代码位置，便于定位后台消失原因。
  const stack = new Error().stack?.split('\n') ?? [];
  const 调用行 = stack.find((line, index) => index >= 2 && line.includes(path.sep)) ?? '';
  const 匹配结果 = 调用行.match(/\(?(.+):(\d+):(\d+)\)?$/);
  if (!匹配结果) {
    return { 文件名: 'unknown', 行号: '0' };
  }
  return {
    文件名: path.basename(匹配结果[1]),
    行号: 匹配结果[2],
  };
}

function 写入诊断日志(主线动作, 模块名, 子动作 = '', 选项 = {}) {
  // 解决：记录会导致后台退出的关键生命周期事件，尤其是普通日志来不及写的路径。
  const 文件路径 = 选项.文件路径 || 诊断日志文件路径;
  if (是测试模式() && !选项.允许测试写入) {
    return '';
  }

  const { 文件名, 行号 } = 解析调用位置();
  const 子动作片段 = 子动作 ? `[${子动作}]` : '';
  const 日志行 = `[${格式化时间()}][${文件名}:${行号}][主线:${主线动作}][${模块名}]${子动作片段}`;
  fs.mkdirSync(path.dirname(文件路径), { recursive: true });
  fs.appendFileSync(文件路径, `${日志行}\n`, 'utf8');
  return 日志行;
}

function 重置诊断日志(选项 = {}) {
  // 解决：后台启动时只保留本次诊断日志，避免旧故障和本次运行混在一起。
  const 文件路径 = 选项.文件路径 || 诊断日志文件路径;
  if (是测试模式() && !选项.允许测试写入) {
    return;
  }

  fs.mkdirSync(path.dirname(文件路径), { recursive: true });
  fs.writeFileSync(文件路径, '', 'utf8');
}

module.exports = {
  写入诊断日志,
  重置诊断日志,
};
