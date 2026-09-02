const { 获取订单统计 } = require('../../order/jdOrderRecordStore');

function 创建批量统计(店铺数量, 开始时间 = new Date().toISOString()) {
  // 解决：批量任务统计集中初始化，避免各分支自己拼字段。
  return {
    totalCount: 店铺数量,
    successCount: 0,
    failedStores: [],
    storeResults: [],
    startedAt: 开始时间,
  };
}

function 记录成功店铺(统计) {
  // 解决：成功计数只由一个函数更新。
  统计.successCount += 1;
}

function 记录失败店铺(统计, 店铺, 错误) {
  // 解决：失败店铺列表集中记录，完成消息能准确列出失败店铺。
  统计.failedStores.push({
    storeId: 店铺.id,
    storeName: 店铺.name,
    message: 错误?.message || '未知错误',
  });
}

function 记录店铺结果(统计, 店铺结果) {
  // 解决：本轮摘要只保存每家店的最终快照，不重新读取历史结果猜测本轮。
  if (!店铺结果 || !店铺结果.storeId) return;
  统计.storeResults.push(店铺结果);
}

function 读取结果记录数量(店铺结果, 字段名, 指标字段名) {
  if (Number.isFinite(Number(店铺结果?.[字段名 === 'records' ? 'scannedRecordCount' : 'newRecordCount']))) {
    return Number(店铺结果[字段名 === 'records' ? 'scannedRecordCount' : 'newRecordCount']);
  }
  if (Array.isArray(店铺结果?.[字段名])) return 店铺结果[字段名].length;
  return Number(店铺结果?.metrics?.[指标字段名] || 0);
}

function 合并发票状态数量(目标, 来源 = {}) {
  Object.entries(来源 || {}).forEach(([状态, 数量]) => {
    目标[状态] = Number(目标[状态] || 0) + Number(数量 || 0);
  });
  return 目标;
}

function 构建店铺结果快照(店铺结果 = {}) {
  return {
    storeId: String(店铺结果.storeId || ''),
    storeName: String(店铺结果.storeName || ''),
    status: String(店铺结果.status || ''),
    statusLabel: String(店铺结果.statusLabel || ''),
    lastCheckedAt: String(店铺结果.lastCheckedAt || ''),
    lastMessage: String(店铺结果.lastMessage || ''),
    screenshotPath: String(店铺结果.screenshotPath || ''),
    scannedRecordCount: 读取结果记录数量(店铺结果, 'records', 'scannedRecordCount'),
    newRecordCount: 读取结果记录数量(店铺结果, 'newRecords', 'newRecordCount'),
    metrics: 店铺结果.metrics || null,
  };
}

function 构建本地订单统计(订单列表 = []) {
  return 获取订单统计(订单列表);
}

function 构建识别摘要({
  执行类型 = 'batch',
  开始时间 = '',
  完成时间 = new Date().toISOString(),
  店铺列表 = [],
  店铺结果列表 = [],
  订单列表 = [],
} = {}) {
  const 标准店铺列表 = Array.isArray(店铺列表) ? 店铺列表 : [];
  const 标准结果列表 = (Array.isArray(店铺结果列表) ? 店铺结果列表 : []).map(构建店铺结果快照);
  const 已完成结果列表 = 标准结果列表.filter((结果) => ['success', 'error'].includes(结果.status));
  const 成功店铺列表 = 已完成结果列表.filter((结果) => 结果.status === 'success');
  const 失败店铺列表 = 已完成结果列表.filter((结果) => 结果.status === 'error');
  const 已完成店铺标识集合 = new Set(已完成结果列表.map((结果) => 结果.storeId));
  const 未完成店铺列表 = 标准店铺列表.filter((店铺) => !已完成店铺标识集合.has(String(店铺.id || '').trim()));
  const 指标汇总 = 标准结果列表.reduce((汇总, 结果) => {
    汇总.scannedRecordCount += Number(结果.scannedRecordCount || 0);
    汇总.newRecordCount += Number(结果.newRecordCount || 0);
    合并发票状态数量(汇总.backendInvoiceStatusCounts, 结果.metrics?.backendInvoiceStatusCounts);
    return 汇总;
  }, { scannedRecordCount: 0, newRecordCount: 0, backendInvoiceStatusCounts: {} });
  const 失败店铺名称列表 = 失败店铺列表.map((结果) => 结果.storeName || 结果.storeId);
  const 未完成店铺名称列表 = 未完成店铺列表.map((店铺) => 店铺.name || 店铺.id);
  const status = 失败店铺名称列表.length || 未完成店铺名称列表.length ? 'error' : 'success';
  const 执行类型文本 = 执行类型 === 'batch' ? '批量识别' : '单店识别';
  return {
    version: 1,
    taskName: 执行类型 === 'batch' ? 'all' : 'single',
    executionType: 执行类型,
    status,
    resultLabel: status === 'success' ? `${执行类型文本}成功` : `${执行类型文本}有问题`,
    startedAt: String(开始时间 || ''),
    finishedAt: String(完成时间 || ''),
    storeCount: 标准店铺列表.length,
    checkedStoreCount: 已完成结果列表.length,
    successStoreCount: 成功店铺列表.length,
    failedStoreCount: 失败店铺列表.length,
    uncheckedStoreCount: 未完成店铺列表.length,
    failedStoreNames: 失败店铺名称列表,
    uncheckedStoreNames: 未完成店铺名称列表,
    scannedRecordCount: 指标汇总.scannedRecordCount,
    newRecordCount: 指标汇总.newRecordCount,
    backendInvoiceStatusCounts: 指标汇总.backendInvoiceStatusCounts,
    localOrderStats: 构建本地订单统计(订单列表),
    storeResults: 标准结果列表,
  };
}

function 构建批量摘要(选项 = {}) {
  // 解决：批量识别结束后固化本轮全部店铺事实，首页重启后仍能读取。
  return 构建识别摘要({ ...选项, 执行类型: 'batch' });
}

function 构建单店摘要(选项 = {}) {
  // 解决：单店识别单独记录，不覆盖最近一次批量识别总览。
  return 构建识别摘要({ ...选项, 执行类型: 'single' });
}

function 构建批量完成消息(统计, 任务名称 = '全部店铺识别') {
  // 解决：批量任务结束时明确展示成功和失败，不只显示任务完成。
  const 失败店铺名称列表 = 统计.failedStores.map((失败项) => 失败项.storeName);
  const 基础消息 = `${任务名称}完成：成功 ${统计.successCount}/${统计.totalCount}，失败 ${统计.failedStores.length}`;
  if (失败店铺名称列表.length === 0) {
    return 基础消息;
  }
  return `${基础消息}。失败店铺：${失败店铺名称列表.join('、')}`;
}

module.exports = {
  创建批量统计,
  记录成功店铺,
  记录失败店铺,
  记录店铺结果,
  构建店铺结果快照,
  构建本地订单统计,
  构建识别摘要,
  构建批量摘要,
  构建单店摘要,
  构建批量完成消息,
};
