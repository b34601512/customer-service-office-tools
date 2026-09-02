const { 读取JSON文件, 写入JSON文件 } = require('../common/fs');
const { 店铺结果文件路径 } = require('../common/paths');
const { 构建批量摘要 } = require('../controlCenter/taskService/batchSummary');

function 构建历史结果总览(结果对象 = {}) {
  const 店铺结果列表 = Object.values(结果对象.stores || {}).filter((店铺结果) => 店铺结果 && typeof 店铺结果 === 'object');
  if (!店铺结果列表.length) return null;
  const 店铺列表 = 店铺结果列表.map((店铺结果) => ({
    id: 店铺结果.storeId,
    name: 店铺结果.storeName,
  }));
  const 历史摘要 = 构建批量摘要({
    开始时间: 店铺结果列表.map((店铺结果) => 店铺结果.lastCheckedAt).filter(Boolean).sort()[0] || '',
    完成时间: 店铺结果列表.map((店铺结果) => 店铺结果.lastCheckedAt).filter(Boolean).sort().at(-1) || '',
    店铺列表,
    店铺结果列表,
    订单列表: [],
  });
  return {
    ...历史摘要,
    taskName: 'legacy-store-results',
    executionType: 'legacy',
    resultLabel: '历史店铺结果总览',
  };
}

function 读取店铺结果() {
  // 解决：后台刷新时统一从磁盘恢复最近一次店铺巡检结果。
  const 读取结果 = 读取JSON文件(店铺结果文件路径, {
    version: 2,
    stores: {},
    lastBatchSummary: null,
    lastSingleSummary: null,
  });
  const 标准结果 = {
    version: 2,
    stores: {},
    lastBatchSummary: null,
    lastSingleSummary: null,
    ...读取结果,
  };
  if (!标准结果.lastBatchSummary) {
    标准结果.lastBatchSummary = 构建历史结果总览(标准结果);
  }
  return 标准结果;
}

function 保存店铺结果(结果对象) {
  // 解决：所有店铺的最后结果都收口到一个文件，方便后台一次性读取。
  写入JSON文件(店铺结果文件路径, 结果对象);
  return 结果对象;
}

function 更新店铺结果(店铺结果) {
  // 解决：单店排查完成后增量更新结果文件，避免不同店铺互相覆盖。
  const 当前结果 = 读取店铺结果();
  const 标准结果 = {
    ...当前结果,
    stores: {
      ...(当前结果.stores || {}),
      [店铺结果.storeId]: 店铺结果,
    },
  };
  保存店铺结果(标准结果);
  return 标准结果;
}

function 更新最近批量摘要(批量摘要) {
  // 解决：批量总览独立落盘，单店识别不会覆盖五店结果。
  const 当前结果 = 读取店铺结果();
  const 标准结果 = {
    ...当前结果,
    version: 2,
    lastBatchSummary: 批量摘要 || null,
  };
  保存店铺结果(标准结果);
  return 标准结果;
}

function 更新最近单店摘要(单店摘要) {
  // 解决：单店最近结果独立落盘，便于回看但不改变批量总览。
  const 当前结果 = 读取店铺结果();
  const 标准结果 = {
    ...当前结果,
    version: 2,
    lastSingleSummary: 单店摘要 || null,
  };
  保存店铺结果(标准结果);
  return 标准结果;
}

module.exports = {
  构建历史结果总览,
  读取店铺结果,
  保存店铺结果,
  更新店铺结果,
  更新最近批量摘要,
  更新最近单店摘要,
};
