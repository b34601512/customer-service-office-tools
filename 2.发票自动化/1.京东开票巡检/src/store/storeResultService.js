const { 读取JSON文件, 写入JSON文件 } = require('../common/fs');
const { 店铺结果文件路径 } = require('../common/paths');

function 读取店铺结果() {
  // 解决：后台刷新时统一从磁盘恢复最近一次店铺巡检结果。
  return 读取JSON文件(店铺结果文件路径, {
    stores: {},
    lastBatchSummary: null,
    lastRunSummary: null,
  });
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

function 更新批量巡检摘要(批量巡检摘要) {
  // 解决：全部店铺巡检结束后持久化完成时间和执行结论，后台重启后首页仍能展示。
  const 当前结果 = 读取店铺结果();
  const 标准结果 = {
    ...当前结果,
    stores: {
      ...(当前结果.stores || {}),
    },
    lastBatchSummary: 批量巡检摘要,
  };
  保存店铺结果(标准结果);
  return 标准结果;
}

function 更新最近巡检摘要(最近巡检摘要) {
  // 解决：CLI返回首页后仍能显示刚刚完成的单店或批量巡检总览。
  const 当前结果 = 读取店铺结果();
  const 标准结果 = {
    ...当前结果,
    lastRunSummary: 最近巡检摘要,
  };
  保存店铺结果(标准结果);
  return 标准结果;
}

module.exports = {
  读取店铺结果,
  保存店铺结果,
  更新店铺结果,
  更新批量巡检摘要,
  更新最近巡检摘要,
};
