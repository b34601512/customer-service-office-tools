const { 获取启用店铺列表 } = require('../store/storeConfigService');
const { 同步抖音待处理订单 } = require('./syncPendingOrders');
const { 执行抖音发票正式回传 } = require('./returnInvoiceToDouyin');
const { 读取店铺发票已登记订单 } = require('../order/douyinOrderRecordStore');
const { 打印日志 } = require('../common/logger');

async function 逐店同步并回传(options = {}) {
  const {
    stores = 获取启用店铺列表(), headless = false, onProgress,
    依赖 = {},
  } = options;
  const sync = 依赖.同步店铺 || 同步抖音待处理订单;
  const readPending = 依赖.读取待回传订单 || 读取店铺发票已登记订单;
  const returnInvoices = 依赖.回传店铺 || 执行抖音发票正式回传;
  if (!stores.length) throw new Error('当前没有选中的启用店铺。');
  const reports = [];
  const reportProgress = (store, progress) => {
    const message = progress.message || '';
    打印日志('抖音发票回传', '逐店处理', `${store.name}｜${message}`);
    if (typeof onProgress === 'function') onProgress({ ...progress, storeId: store.id, storeName: store.name });
  };
  for (const [index, store] of stores.entries()) {
    let report;
    let orders = [];
    const latestItems = new Map();
    try {
      reportProgress(store, { type: 'stage', message: `第 ${index + 1}/${stores.length} 家：同步当前待回传订单` });
      const snapshot = await sync({ 店铺配置: store, headless });
      // 当前平台快照限定本轮范围；本地记录提供成功状态与持久化 key。
      const currentNumbers = new Set(snapshot.orders.map((order) => String(order.orderNumber)));
      orders = readPending(store, { 要求已登记: false })
        .filter((order) => currentNumbers.has(String(order.orderNumber)));
      if (!orders.length) {
        report = { status: 'skipped', message: '当前没有待回传订单。', items: [] };
      } else {
        reportProgress(store, { type: 'stage', message: `同步完成，立即回传本店 ${orders.length} 单` });
        report = await returnInvoices({
          店铺配置: store, headless, orders, 要求已登记: false,
          onProgress: (progress) => {
            if (progress.item?.key) latestItems.set(progress.item.key, { ...progress.item, status: progress.status });
            reportProgress(store, progress);
          },
        });
      }
    } catch (error) {
      report = {
        status: 'error', message: error.message,
        items: orders.map((order) => {
          const item = latestItems.get(order.key);
          return item && ['success', 'skipped', 'error'].includes(item.status)
            ? item : { ...order, status: 'error', message: error.message };
        }),
      };
    }
    const items = report.items || [];
    const success = items.filter((item) => item.status === 'success').length;
    const skipped = items.filter((item) => item.status === 'skipped').length;
    const failed = items.filter((item) => item.status === 'error').length;
    const status = success && success < items.length ? 'partial' : report.status;
    const result = { ...report, storeId: store.id, storeName: store.name, status, total: items.length, success, skipped, error: failed };
    reports.push(result);
    reportProgress(store, { type: 'store', status, message: `[店铺] ${store.name}｜${status}｜成功 ${success}/${items.length}｜跳过 ${skipped}｜失败 ${failed}｜${report.message}` });
  }
  const summary = {
    storeTotal: reports.length,
    storeError: reports.filter((report) => report.status === 'error').length,
    orderTotal: reports.reduce((sum, report) => sum + report.total, 0),
    success: reports.reduce((sum, report) => sum + report.success, 0),
    skipped: reports.reduce((sum, report) => sum + report.skipped, 0),
    error: reports.reduce((sum, report) => sum + report.error, 0),
  };
  const message = `本轮结束：${summary.storeTotal} 家店，失败店铺 ${summary.storeError} 家；订单成功 ${summary.success}、跳过 ${summary.skipped}、失败 ${summary.error}。`;
  打印日志('抖音发票回传', '汇总', message);
  return { stores: reports, summary, message };
}

module.exports = { 逐店同步并回传 };
