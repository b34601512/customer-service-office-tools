// 该文件用于解决三个电商平台批量回传时逐店隔离失败、逐单持久化进度并生成统一汇总报告的问题。

const {
  是待回传订单,
} = require('../共享订单状态/orderWorkflow');

const 回传进度状态 = Object.freeze({
  排队中: 'queued',
  下载中: 'downloading',
  已下载: 'downloaded',
  上传中: 'uploading',
  成功: 'success',
  跳过: 'skipped',
  失败: 'error',
});

const 最终状态集合 = new Set([
  回传进度状态.成功,
  回传进度状态.跳过,
  回传进度状态.失败,
]);

function 读取店铺标识(store = {}) {
  return String(store.id || store.storeId || store.name || store.storeName || '').trim();
}

function 读取店铺名称(store = {}) {
  return String(store.name || store.storeName || store.id || store.storeId || '未命名店铺').trim();
}

function 读取订单标识(order = {}, index = 0) {
  return String(
    order.key
      || order.orderKey
      || order.orderNumber
      || order.orderNo
      || order.orderId
      || order.id
      || `index-${index}`,
  ).trim();
}

function 读取订单号(order = {}) {
  return String(order.orderNumber || order.orderNo || order.orderId || order.id || order.key || '').trim();
}

function 规范化回传进度状态(status, 默认状态 = 回传进度状态.排队中) {
  const value = String(status || '').trim().toLowerCase();
  const aliases = {
    queued: 回传进度状态.排队中,
    pending: 回传进度状态.排队中,
    downloading: 回传进度状态.下载中,
    downloaded: 回传进度状态.已下载,
    uploading: 回传进度状态.上传中,
    success: 回传进度状态.成功,
    succeeded: 回传进度状态.成功,
    skipped: 回传进度状态.跳过,
    skip: 回传进度状态.跳过,
    error: 回传进度状态.失败,
    failed: 回传进度状态.失败,
    failure: 回传进度状态.失败,
  };
  return aliases[value] || 默认状态;
}

function 构建初始订单进度(order, store, index, now) {
  return {
    key: 读取订单标识(order, index),
    orderNumber: 读取订单号(order),
    storeId: 读取店铺标识(store),
    storeName: 读取店铺名称(store),
    status: 回传进度状态.排队中,
    message: '等待回传',
    updatedAt: now,
  };
}

function 查找订单进度索引(items, progress = {}) {
  const keyCandidates = [
    progress.key,
    progress.orderKey,
    progress.orderNumber,
    progress.orderNo,
    progress.orderId,
    progress.id,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  const directIndex = Number(progress.index);
  if (Number.isInteger(directIndex) && directIndex >= 0 && directIndex < items.length) return directIndex;
  return items.findIndex((item) => keyCandidates.includes(item.key) || keyCandidates.includes(item.orderNumber));
}

function 读取结果订单列表(result = {}) {
  const candidates = [result.items, result.orders, result.results, result.orderResults];
  return candidates.find(Array.isArray) || [];
}

function 读取结果整体状态(result = {}) {
  return 规范化回传进度状态(
    result.status || result.result || result.state,
    回传进度状态.失败,
  );
}

function 构建店铺汇总(store, items, extra = {}) {
  const counts = {
    total: items.length,
    success: items.filter((item) => item.status === 回传进度状态.成功).length,
    skipped: items.filter((item) => item.status === 回传进度状态.跳过).length,
    error: items.filter((item) => item.status === 回传进度状态.失败).length,
  };
  let status = 'error';
  if (counts.total === 0 || counts.skipped === counts.total) status = 'skipped';
  else if (counts.success === counts.total) status = 'success';
  else if (counts.success > 0) status = 'partial';
  else if (counts.error > 0) status = 'error';
  return {
    storeId: 读取店铺标识(store),
    storeName: 读取店铺名称(store),
    status,
    ...counts,
    items,
    ...extra,
  };
}

function 构建批量汇总(storeReports = []) {
  const reports = Array.isArray(storeReports) ? storeReports : [];
  return {
    storeTotal: reports.length,
    storeSuccess: reports.filter((item) => item.status === 'success').length,
    storePartial: reports.filter((item) => item.status === 'partial').length,
    storeSkipped: reports.filter((item) => item.status === 'skipped').length,
    storeError: reports.filter((item) => item.status === 'error').length,
    orderTotal: reports.reduce((sum, item) => sum + item.total, 0),
    success: reports.reduce((sum, item) => sum + item.success, 0),
    skipped: reports.reduce((sum, item) => sum + item.skipped, 0),
    error: reports.reduce((sum, item) => sum + item.error, 0),
  };
}

async function 安全持久化订单进度({ 记录订单进度, store, order, item, progress }) {
  if (typeof 记录订单进度 !== 'function') return '';
  try {
    await 记录订单进度({ store, order, item: { ...item }, progress: { ...progress } });
    return '';
  } catch (error) {
    return String(error?.message || error || '订单进度保存失败');
  }
}

async function 应用订单进度({ items, orders, store, progress, 记录订单进度, now }) {
  const index = 查找订单进度索引(items, progress);
  if (index < 0) return false;
  const current = items[index];
  const next = {
    ...current,
    ...progress,
    key: current.key,
    orderNumber: current.orderNumber,
    storeId: current.storeId,
    storeName: current.storeName,
    status: 规范化回传进度状态(progress.status, current.status),
    message: String(progress.message || progress.errorMessage || current.message || '').trim(),
    updatedAt: now(),
  };
  const persistenceError = await 安全持久化订单进度({
    记录订单进度,
    store,
    order: orders[index],
    item: next,
    progress,
  });
  if (persistenceError) next.persistenceError = persistenceError;
  items[index] = next;
  return true;
}

async function 完成未结束订单({ items, orders, store, status, message, 记录订单进度, now }) {
  for (let index = 0; index < items.length; index += 1) {
    if (最终状态集合.has(items[index].status)) continue;
    await 应用订单进度({
      items,
      orders,
      store,
      progress: { index, status, message },
      记录订单进度,
      now,
    });
  }
}

async function 执行单个店铺({
  store,
  读取店铺订单,
  执行单店回传,
  记录订单进度,
  输出进度,
  要求已登记 = true,
  now,
}) {
  let allOrders = [];
  try {
    allOrders = await 读取店铺订单(store);
  } catch (error) {
    return 构建店铺汇总(store, [], { errorMessage: String(error?.message || error) });
  }
  const orders = (Array.isArray(allOrders) ? allOrders : []).filter((order) => 是待回传订单(order, { 要求已登记 }));
  const items = orders.map((order, index) => 构建初始订单进度(order, store, index, now()));
  for (let index = 0; index < items.length; index += 1) {
    const persistenceError = await 安全持久化订单进度({
      记录订单进度,
      store,
      order: orders[index],
      item: items[index],
      progress: items[index],
    });
    if (persistenceError) items[index].persistenceError = persistenceError;
  }
  if (orders.length === 0) return 构建店铺汇总(store, items, { message: 要求已登记 ? '没有发票已登记且待回传的订单。' : '没有已同步且待回传的订单。' });

  const onProgress = async (progress = {}) => {
    const applied = await 应用订单进度({ items, orders, store, progress, 记录订单进度, now });
    if (applied && typeof 输出进度 === 'function') await 输出进度({ store, progress: { ...progress } });
  };

  try {
    const result = await 执行单店回传({ store, orders: [...orders], onProgress });
    for (const progress of 读取结果订单列表(result)) await onProgress(progress);
    const overallStatus = 读取结果整体状态(result);
    await 完成未结束订单({
      items,
      orders,
      store,
      status: overallStatus,
      message: result?.message || (overallStatus === 回传进度状态.成功 ? '回传成功' : '回传未成功'),
      记录订单进度,
      now,
    });
    return 构建店铺汇总(store, items, { message: String(result?.message || '').trim() });
  } catch (error) {
    const errorMessage = String(error?.message || error || '店铺回传失败');
    await 完成未结束订单({
      items,
      orders,
      store,
      status: 回传进度状态.失败,
      message: errorMessage,
      记录订单进度,
      now,
    });
    return 构建店铺汇总(store, items, { errorMessage });
  }
}

async function 执行多店铺发票回传(options = {}) {
  const {
    stores = [],
    读取店铺订单,
    执行单店回传,
    记录订单进度,
    输出进度,
    输出汇总,
    要求已登记 = true,
    now = () => new Date().toISOString(),
  } = options;
  if (typeof 读取店铺订单 !== 'function') throw new Error('缺少读取店铺订单函数。');
  if (typeof 执行单店回传 !== 'function') throw new Error('缺少执行单店回传函数。');
  const startedAt = now();
  const storeReports = [];
  for (const store of Array.isArray(stores) ? stores : []) {
    const report = await 执行单个店铺({
      store,
      读取店铺订单,
      执行单店回传,
      记录订单进度,
      输出进度,
      要求已登记,
      now,
    });
    storeReports.push(report);
  }
  const report = {
    startedAt,
    completedAt: now(),
    stores: storeReports,
    summary: 构建批量汇总(storeReports),
  };
  if (typeof 输出汇总 === 'function') await 输出汇总(report);
  return report;
}

module.exports = {
  回传进度状态,
  读取店铺标识,
  读取店铺名称,
  读取订单标识,
  读取订单号,
  规范化回传进度状态,
  构建初始订单进度,
  查找订单进度索引,
  读取结果订单列表,
  构建店铺汇总,
  构建批量汇总,
  执行多店铺发票回传,
};
