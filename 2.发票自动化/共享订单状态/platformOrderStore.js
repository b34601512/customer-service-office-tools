// 该文件用于把平台只读同步结果接入隔离 JSON 仓库，并统一提供四阶段、备注与单次回传凭证操作。

const path = require('node:path');
const {
  创建订单记录仓库,
  格式化时间批次,
} = require('./orderRecordStore');
const {
  规范化工作流状态,
  是待回传订单,
  获取订单统计,
} = require('./orderWorkflow');

const 订单备注字数上限 = 500;

function 规范化文本(value) {
  return String(value ?? '').trim();
}

function 规范化订单备注(value) {
  const text = 规范化文本(value);
  if (text.length > 订单备注字数上限) throw new Error(`保存备注失败：备注不能超过 ${订单备注字数上限} 个字。`);
  return text;
}

function 构建平台订单Key(store = {}, order = {}) {
  const storeId = 规范化文本(order.storeId || store.id || store.storeId);
  const orderNumber = 规范化文本(order.orderNumber || order.orderNo || order.orderId || order.id);
  if (!storeId) throw new Error('同步待处理订单失败：店铺标识不能为空。');
  if (!orderNumber) throw new Error('同步待处理订单失败：订单号不能为空。');
  return `${storeId}:${orderNumber}`;
}

function 读取备份根目录(filePath, defaultFilePath, projectRoot) {
  if (path.resolve(filePath) === path.resolve(defaultFilePath)) {
    return path.join(path.parse(path.resolve(projectRoot)).root, '备份文件夹');
  }
  return path.join(path.dirname(path.resolve(filePath)), 'backup');
}

function 创建平台订单状态服务(options = {}) {
  const platformName = 规范化文本(options.platformName);
  const projectName = 规范化文本(options.projectName || platformName);
  const defaultFilePath = path.resolve(规范化文本(options.defaultFilePath));
  const projectRoot = path.resolve(规范化文本(options.projectRoot));
  const buildSnapshot = options.buildSnapshot;
  if (!platformName || !projectName || !options.defaultFilePath || !options.projectRoot) {
    throw new Error('创建平台订单服务失败：平台名、项目名、数据路径和项目根目录均不能为空。');
  }
  if (typeof buildSnapshot !== 'function') throw new Error('创建平台订单服务失败：缺少订单快照构建函数。');

  function 创建订单仓库(filePath = defaultFilePath) {
    const backupRoot = 读取备份根目录(filePath, defaultFilePath, projectRoot);
    return 创建订单记录仓库({
      filePath,
      buildMigrationBackupPath: (sourcePath, now) => path.join(
        backupRoot,
        `发票自动化-订单状态迁移-${格式化时间批次(now)}`,
        projectName,
        path.basename(sourcePath),
      ),
    });
  }

  function 构建订单快照(store, order, now) {
    const key = 构建平台订单Key(store, order);
    const snapshot = buildSnapshot(store, order, now) || {};
    return {
      ...order,
      ...snapshot,
      key,
      storeId: 规范化文本(order.storeId || store.id || store.storeId),
      storeName: 规范化文本(order.storeName || store.name || store.storeName),
      orderNumber: 规范化文本(order.orderNumber || order.orderNo || order.orderId || order.id),
      source: 规范化文本(snapshot.source || order.source || `${platformName}只读同步`),
    };
  }

  function 同步待处理订单({ store = {}, orders = [] } = {}, filePath = defaultFilePath) {
    const now = new Date().toISOString();
    const snapshots = (Array.isArray(orders) ? orders : []).map((order) => 构建订单快照(store, order, now));
    return 创建订单仓库(filePath).同步订单记录(snapshots);
  }

  function 读取订单数据(filePath = defaultFilePath) {
    return 创建订单仓库(filePath).读取订单数据();
  }

  function 读取订单列表(filePath = defaultFilePath) {
    const repository = 创建订单仓库(filePath);
    return repository.记录转列表(repository.读取订单数据());
  }

  function 统计订单列表(filePath = defaultFilePath) {
    return 获取订单统计(读取订单列表(filePath));
  }

  function 更新订单工作流状态(key, targetStatus, filePath = defaultFilePath) {
    return 创建订单仓库(filePath).转换订单状态(key, 规范化工作流状态(targetStatus));
  }

  function 设置订单备注(key, noteText, filePath = defaultFilePath) {
    return 创建订单仓库(filePath).更新订单记录(key, { noteText: 规范化订单备注(noteText) });
  }

  function 设置订单回传尝试(key, attempt = {}, filePath = defaultFilePath) {
    const repository = 创建订单仓库(filePath);
    const updated = repository.记录订单回传尝试(key, attempt);
    if (String(attempt.status || '') !== 'success') return updated;
    const now = new Date().toISOString();
    return repository.更新订单记录(key, {
      invoiceReturned: true,
      invoiceReturnedAt: now,
      invoiceReturnFilePath: 规范化文本(attempt.invoiceFilePath),
      invoiceReturnScreenshotPath: 规范化文本(attempt.screenshotPath),
      invoiceReturnMessage: 规范化文本(attempt.message || '发票回传成功。'),
    });
  }

  function 读取店铺发票已登记订单(store = {}, 选项 = {}, filePath = defaultFilePath) {
    // 兼容旧调用：第二个参数直接传文件路径字符串时按原语义处理。
    if (typeof 选项 === 'string') {
      filePath = 选项;
      选项 = {};
    }
    const 要求已登记 = 选项?.要求已登记 !== false;
    const storeId = 规范化文本(store.id || store.storeId);
    return 读取订单列表(filePath).filter((order) => (
      规范化文本(order.storeId) === storeId && 是待回传订单(order, { 要求已登记 })
    ));
  }

  return Object.freeze({
    platformName,
    projectName,
    defaultFilePath,
    创建订单仓库,
    构建订单快照,
    同步待处理订单,
    读取订单数据,
    读取订单列表,
    统计订单列表,
    更新订单工作流状态,
    设置订单备注,
    设置订单回传尝试,
    读取店铺发票已登记订单,
  });
}

module.exports = {
  订单备注字数上限,
  规范化文本,
  规范化订单备注,
  构建平台订单Key,
  创建平台订单状态服务,
};
