const fs = require('fs');
const path = require('path');
const { 格式化时间 } = require('./time');
const { 解析调用位置 } = require('./logger');
const { 诊断日志文件路径 } = require('./paths');

function 是测试模式() {
  // 解决：自动测试不能写真实诊断日志，避免污染用户本机运行证据。
  return process.env.JD_INVOICE_URGE_TEST_MODE === '1';
}

function 写入诊断日志(主线动作, 模块名, 子动作 = '', 选项 = {}) {
  // 解决：记录会导致后台消失的关键生命周期事件，尤其是普通日志来不及写的路径。
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
  // 解决：只在后台启动时清空本次诊断日志，避免巡检初始化擦掉故障证据。
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
