const fs = require('fs');
const { 催票订单记录文件路径 } = require('../common/paths');
const { 读取性能清理摘要 } = require('../common/performanceCleanupState');
const {
  读取订单记录,
  统计订单记录,
  归档清理已处理订单,
} = require('../order/jdOrderRecordStore');

function 获取文件体积字节(文件路径) {
  // 解决：性能面板展示当前订单文件体积，不存在时按 0 处理。
  if (!fs.existsSync(文件路径)) {
    return 0;
  }
  return fs.statSync(文件路径).size;
}

function 读取历史记录性能状态(文件路径 = 催票订单记录文件路径) {
  // 解决：集中统计订单历史数量和文件体积，让性能面板不直接理解订单 JSON。
  const 订单数据 = 读取订单记录(文件路径);
  const 统计 = 统计订单记录(订单数据);
  return {
    ...统计,
    activeCount: 统计.total - 统计.handled,
    orderRecordFileBytes: 获取文件体积字节(文件路径),
  };
}

function 读取性能面板摘要(选项 = {}) {
  // 解决：把自动清理和历史记录状态合成一个接口返回给首页弹窗。
  const {
    orderRecordFilePath = 催票订单记录文件路径,
  } = 选项;
  return {
    autoCleanup: 读取性能清理摘要(),
    history: 读取历史记录性能状态(orderRecordFilePath),
  };
}

function 归档清理已处理历史记录(选项 = {}) {
  // 解决：一键清理只负责归档并移出已处理订单，随后返回最新性能摘要。
  const {
    orderRecordFilePath = 催票订单记录文件路径,
  } = 选项;
  const result = 归档清理已处理订单(orderRecordFilePath);
  return {
    ...result,
    performance: 读取性能面板摘要({ orderRecordFilePath }),
  };
}

module.exports = {
  获取文件体积字节,
  读取历史记录性能状态,
  读取性能面板摘要,
  归档清理已处理历史记录,
};
