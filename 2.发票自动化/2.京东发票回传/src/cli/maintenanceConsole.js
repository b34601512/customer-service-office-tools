const fs = require('fs');
const path = require('path');
const { 项目根目录, 本次日志文件路径 } = require('../common/paths');
const {
  读取性能面板摘要,
  归档清理已处理历史记录,
} = require('../controlCenter/performanceService');

const 共享打开文件夹模块路径 = [
  path.resolve(__dirname, '../../../共享CLI/打开文件夹.js'),
  path.resolve(__dirname, '../../共享CLI/打开文件夹.js'),
].find(fs.existsSync);
const { 打开文件夹 } = require(共享打开文件夹模块路径);

function 格式化字节数(字节数) {
  const 数值 = Number(字节数 || 0);
  if (数值 < 1024) return `${数值} B`;
  if (数值 < 1024 * 1024) return `${(数值 / 1024).toFixed(1)} KB`;
  return `${(数值 / 1024 / 1024).toFixed(1)} MB`;
}

function 输出性能摘要({ 输出, 摘要 = 读取性能面板摘要() }) {
  const 历史 = 摘要.history || {};
  const 自动清理 = 摘要.autoCleanup || {};
  const 合计 = 自动清理.totals || {};
  输出('[性能]');
  输出(`已处理 ${历史.handled || 0} 条｜当前保留 ${历史.activeCount || 0} 条｜订单文件 ${格式化字节数(历史.orderRecordFileBytes)}`);
  输出(`本次启动清理：检查 ${合计.runCount || 0} 次｜迁移 ${合计.movedCount || 0} 项｜归档 ${合计.removedOrderCount || 0} 条｜释放 ${格式化字节数(合计.movedBytes)}`);
  const 最近清理 = Array.isArray(自动清理.autoCleanupRuns) ? 自动清理.autoCleanupRuns.slice(-5) : [];
  最近清理.forEach((记录) => {
    输出(`  ${记录.cleanupType || '自动清理'}｜${记录.cleanedAt || '时间未知'}｜迁移 ${记录.movedCount || 0} 项｜归档 ${记录.removedOrderCount || 0} 条`);
  });
}

function 读取最近日志行(最大行数 = 200) {
  if (!fs.existsSync(本次日志文件路径)) return [];
  return fs.readFileSync(本次日志文件路径, 'utf8').split(/\r?\n/).filter(Boolean).slice(-最大行数);
}

function 输出最近日志({ 输出, 最大行数 = 200 }) {
  const 日志行列表 = 读取最近日志行(最大行数);
  输出(`[日志] 最近 ${日志行列表.length} 行`);
  输出(日志行列表.length ? 日志行列表.join('\n') : '暂无运行日志。');
}

function 归档清理已处理记录() {
  return 归档清理已处理历史记录();
}

async function 打开项目目录() {
  return 打开文件夹(项目根目录, { 文件夹名称: '项目目录' });
}

module.exports = {
  格式化字节数,
  输出性能摘要,
  读取最近日志行,
  输出最近日志,
  归档清理已处理记录,
  打开项目目录,
};
