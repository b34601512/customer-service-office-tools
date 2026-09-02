// 该文件用于让正式回传只接收发票已登记订单，并把平台进度同步写入独立的单次回传状态。

const {
  是待回传订单,
} = require('../共享订单状态/orderWorkflow');

const 可持久化进度状态 = new Set([
  'queued',
  'downloading',
  'downloaded',
  'uploading',
  'success',
  'skipped',
  'error',
]);

function 读取订单标识(order = {}) {
  return String(order.key || order.orderKey || order.orderNumber || order.orderNo || order.orderId || '').trim();
}

function 读取店铺标识(store = {}) {
  return String(store.id || store.storeId || '').trim();
}

function 选择正式回传订单({ store = {}, orders, 读取本地订单列表, 要求已登记 = true } = {}) {
  const source = Array.isArray(orders)
    ? orders
    : (typeof 读取本地订单列表 === 'function' ? 读取本地订单列表() : []);
  const storeId = 读取店铺标识(store);
  return (Array.isArray(source) ? source : []).filter((order) => (
    (!storeId || String(order.storeId || '').trim() === storeId)
    && 是待回传订单(order, { 要求已登记 })
  ));
}

function 创建正式回传闸门(options = {}) {
  const selectedOrders = 选择正式回传订单(options);
  const orderMap = new Map(selectedOrders.map((order) => [读取订单标识(order), order]));
  const progressMap = new Map(selectedOrders.map((order) => [读取订单标识(order), {
    key: 读取订单标识(order),
    orderNumber: String(order.orderNumber || ''),
    status: 'queued',
    message: '等待回传',
  }]));

  function 持久化并转发进度(progress = {}) {
    const item = progress.item || progress.order || {};
    const key = 读取订单标识(item);
    const status = String(progress.status || item.status || '').trim().toLowerCase();
    if (key && orderMap.has(key) && 可持久化进度状态.has(status)) {
      const current = progressMap.get(key) || {};
      const next = {
        ...current,
        ...item,
        key,
        orderNumber: String(item.orderNumber || current.orderNumber || orderMap.get(key).orderNumber || ''),
        status,
        message: String(progress.message || item.message || ''),
      };
      progressMap.set(key, next);
      if (typeof options.记录订单回传尝试 === 'function') {
        options.记录订单回传尝试(key, {
          status,
          message: next.message,
          invoiceFilePath: String(item.invoiceFilePath || ''),
          screenshotPath: String(item.screenshotPath || ''),
        });
      }
    }
    if (typeof options.onProgress === 'function') options.onProgress(progress);
  }

  function 读取逐单结果() {
    return selectedOrders.map((order) => ({
      ...order,
      ...(progressMap.get(读取订单标识(order)) || {}),
    }));
  }

  return Object.freeze({
    orders: selectedOrders,
    onProgress: 持久化并转发进度,
    读取逐单结果,
  });
}

function 构建无已登记订单结果(platformName, store = {}) {
  const storeName = String(store.name || store.storeName || store.id || '当前店铺').trim();
  return {
    status: 'skipped',
    message: `${platformName}「${storeName}」没有发票已登记且待回传的订单。`,
    exportFilePath: '',
    totalCount: 0,
    downloadedCount: 0,
    uploadedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    submitted: false,
    orders: [],
    uploads: [],
    items: [],
  };
}

function 合并正式回传结果(result = {}, gate) {
  const items = gate.读取逐单结果();
  const successCount = items.filter((item) => item.status === 'success').length;
  const skippedCount = items.filter((item) => item.status === 'skipped').length;
  const errorCount = items.filter((item) => item.status === 'error').length;
  const status = items.length && successCount === items.length
    ? 'success'
    : (items.length && skippedCount === items.length ? 'skipped' : 'error');
  return { ...result, status, items, successCount, skippedCount, errorCount };
}

async function 执行受控正式回传({ platformName, store, gate, execute }) {
  if (!gate.orders.length) return 构建无已登记订单结果(platformName, store);
  try {
    return 合并正式回传结果(await execute(gate.orders, gate.onProgress), gate);
  } catch (error) {
    for (const item of gate.读取逐单结果()) {
      if (['success', 'skipped', 'error'].includes(item.status)) continue;
      gate.onProgress({
        type: 'item',
        status: 'error',
        message: String(error?.message || error || '店铺回传失败'),
        item,
      });
    }
    throw error;
  }
}

module.exports = {
  可持久化进度状态,
  读取订单标识,
  读取店铺标识,
  选择正式回传订单,
  创建正式回传闸门,
  构建无已登记订单结果,
  合并正式回传结果,
  执行受控正式回传,
};
