// 该文件用于把抖音只读订单同步到平台独立 JSON，并向 CLI 与正式回传提供同一份四阶段订单事实。

const fs = require('node:fs');
const path = require('node:path');
const { 项目根目录, 数据目录 } = require('../common/paths');

function 加载共享模块(fileName) {
  const candidates = [
    path.resolve(__dirname, '../../../共享订单状态', fileName),
    path.resolve(__dirname, '../../共享订单状态', fileName),
  ];
  const target = candidates.find((candidate) => fs.existsSync(candidate));
  if (!target) throw new Error(`缺少共享订单状态模块：${fileName}`);
  return require(target);
}

const { 创建平台订单状态服务 } = 加载共享模块('platformOrderStore.js');
const workflow = 加载共享模块('orderWorkflow.js');
const 抖音订单记录文件路径 = path.join(数据目录, 'invoice-order-records.json');

function 构建抖音订单快照(store, order, now) {
  const operationStatus = String(order.operationStatus || order.orderStatus || '').trim();
  const parts = [
    operationStatus,
    String(order.invoiceStatus || '').trim() && `发票：${String(order.invoiceStatus).trim()}`,
    String(order.invoiceUploadMode || '').trim() && `方式：${String(order.invoiceUploadMode).trim()}`,
  ].filter(Boolean);
  return {
    source: '抖音待回传订单报表只读同步',
    platformStatus: {
      kind: operationStatus === '可上传发票' ? 'returnable' : (operationStatus === '待确认' ? 'pending_confirm' : 'unknown'),
      text: parts.join('｜') || '待处理',
      updatedAt: now,
    },
  };
}

const 服务 = 创建平台订单状态服务({
  platformName: '抖音',
  projectName: '6.抖音发票回传',
  defaultFilePath: 抖音订单记录文件路径,
  projectRoot: 项目根目录,
  buildSnapshot: 构建抖音订单快照,
});

function 同步抖音待处理订单({ store = {}, orders = [] } = {}, filePath = 抖音订单记录文件路径) {
  // 抖音后台列表是本店当前事实快照，旧订单不应继续进入回传队列。
  const storeId = String(store.id || store.storeId || '').trim();
  if (!storeId) throw new Error('同步待处理订单失败：店铺标识不能为空。');
  const repository = 服务.创建订单仓库(filePath);
  const data = repository.读取订单数据();
  const incomingNumbers = new Set((Array.isArray(orders) ? orders : [])
    .map((order) => String(order?.orderNumber || order?.orderNo || order?.orderId || order?.id || '').trim())
    .filter(Boolean));
  for (const [key, record] of Object.entries(data.orders || {})) {
    if (String(record.storeId || '').trim() === storeId
      && !incomingNumbers.has(String(record.orderNumber || '').trim())) delete data.orders[key];
  }
  repository.保存订单数据(data);
  return 服务.同步待处理订单({ store, orders }, filePath);
}

module.exports = {
  抖音订单记录文件路径,
  构建抖音订单快照,
  ...服务,
  同步待处理订单: 同步抖音待处理订单,
  ...workflow,
};
