const fs = require('fs');
const path = require('path');
const { 项目根目录, 运行目录 } = require('./paths');
const { 读取JSON文件, 写入JSON文件 } = require('./fs');

const 性能清理状态文件名 = 'performance-cleanup-state.json';

function 获取性能清理状态文件路径(projectRoot = 项目根目录) {
  // 解决：自动清理状态固定写在 runtime 根目录，避免被浏览器档案清理一起迁移走。
  if (path.resolve(projectRoot) === path.resolve(项目根目录)) {
    return path.join(运行目录, 性能清理状态文件名);
  }
  return path.join(projectRoot, 'runtime', 性能清理状态文件名);
}

function 创建空性能清理状态(now = new Date()) {
  // 解决：每次后台启动都从空状态开始统计，首页只展示本次启动的清理情况。
  return {
    version: 1,
    resetAt: now.toISOString(),
    updatedAt: now.toISOString(),
    autoCleanupRuns: [],
  };
}

function 重置性能清理状态(选项 = {}) {
  // 解决：后台启动时清空上一轮清理摘要，避免用户误以为旧清理发生在本次启动。
  const {
    projectRoot = 项目根目录,
    now = new Date(),
  } = 选项;
  const 状态 = 创建空性能清理状态(now);
  写入JSON文件(获取性能清理状态文件路径(projectRoot), 状态);
  return 状态;
}

function 读取性能清理状态(选项 = {}) {
  // 解决：性能面板读取自动清理摘要时不存在文件也能得到稳定结构。
  const {
    projectRoot = 项目根目录,
  } = 选项;
  const 文件路径 = 获取性能清理状态文件路径(projectRoot);
  if (!fs.existsSync(文件路径)) {
    return 创建空性能清理状态(new Date(0));
  }
  const 状态 = 读取JSON文件(文件路径, 创建空性能清理状态(new Date(0)));
  return {
    version: 1,
    resetAt: String(状态.resetAt || ''),
    updatedAt: String(状态.updatedAt || ''),
    autoCleanupRuns: Array.isArray(状态.autoCleanupRuns) ? 状态.autoCleanupRuns : [],
  };
}

function 格式化清理条目(item) {
  // 解决：只把性能面板需要展示的迁移字段写入状态文件，避免泄露运行对象。
  return {
    sourcePath: String(item?.原路径 || item?.sourcePath || ''),
    backupPath: String(item?.备份路径 || item?.backupPath || ''),
    bytes: Number(item?.字节数 || item?.bytes || 0),
  };
}

function 计算自动清理合计(autoCleanupRuns = []) {
  // 解决：接口层直接拿到汇总数字，前端不需要重复理解清理明细结构。
  const runs = Array.isArray(autoCleanupRuns) ? autoCleanupRuns : [];
  return runs.reduce((合计, run) => {
    合计.runCount += 1;
    合计.checkedPathCount += Number(run.checkedPathCount || 0);
    合计.movedCount += Number(run.movedCount || 0);
    合计.movedBytes += Number(run.movedBytes || 0);
    合计.removedOrderCount += Number(run.removedOrderCount || 0);
    return 合计;
  }, {
    runCount: 0,
    checkedPathCount: 0,
    movedCount: 0,
    movedBytes: 0,
    removedOrderCount: 0,
  });
}

function 记录自动清理结果(记录 = {}) {
  // 解决：每次自动清理无论是否迁移缓存都写入一次，性能面板才能解释“没清理”的原因。
  const {
    projectRoot = 项目根目录,
    now = new Date(),
    cleanupType = '',
    moduleName = '',
    checkedPathCount = 0,
    thresholdBytes = 0,
    cleanupResults = [],
    removedOrderCount = 0,
    backupPath = '',
  } = 记录;
  const 文件路径 = 获取性能清理状态文件路径(projectRoot);
  fs.mkdirSync(path.dirname(文件路径), { recursive: true });
  const 当前状态 = 读取性能清理状态({ projectRoot });
  const 清理条目列表 = (Array.isArray(cleanupResults) ? cleanupResults : []).map(格式化清理条目);
  const 清理记录 = {
    cleanedAt: now.toISOString(),
    cleanupType: String(cleanupType || ''),
    moduleName: String(moduleName || ''),
    checkedPathCount: Number(checkedPathCount || 0),
    thresholdBytes: Number(thresholdBytes || 0),
    movedCount: 清理条目列表.length,
    movedBytes: 清理条目列表.reduce((sum, item) => sum + Number(item.bytes || 0), 0),
    removedOrderCount: Number(removedOrderCount || 0),
    backupPath: String(backupPath || ''),
    movedItems: 清理条目列表,
  };
  const 下一状态 = {
    version: 1,
    resetAt: 当前状态.resetAt || now.toISOString(),
    updatedAt: now.toISOString(),
    autoCleanupRuns: [...当前状态.autoCleanupRuns, 清理记录],
  };
  写入JSON文件(文件路径, 下一状态);
  return 下一状态;
}

function 读取性能清理摘要(选项 = {}) {
  // 解决：把自动清理原始记录和汇总数字打包给性能面板展示。
  const 状态 = 读取性能清理状态(选项);
  return {
    ...状态,
    totals: 计算自动清理合计(状态.autoCleanupRuns),
  };
}

module.exports = {
  获取性能清理状态文件路径,
  创建空性能清理状态,
  重置性能清理状态,
  读取性能清理状态,
  记录自动清理结果,
  计算自动清理合计,
  读取性能清理摘要,
};
