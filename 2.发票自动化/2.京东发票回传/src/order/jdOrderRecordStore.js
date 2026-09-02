// 该文件用于把京东催票订单字段、回传凭证和归档索引接到共享单一工作流仓库，同时保留京东专属操作。

const fs = require('node:fs');
const path = require('node:path');
const {
  催票订单记录文件路径,
  规范化店铺标识,
  项目根目录,
  获取当前硬盘备份目录,
} = require('../common/paths');

function 加载共享模块(fileName) {
  const candidates = [
    path.resolve(__dirname, '../../../共享订单状态', fileName),
    path.resolve(__dirname, '../../共享订单状态', fileName),
  ];
  const target = candidates.find((candidate) => fs.existsSync(candidate));
  if (!target) throw new Error(`缺少共享订单状态模块：${fileName}`);
  return require(target);
}

const {
  创建订单记录仓库,
  迁移订单数据,
  格式化时间批次,
} = 加载共享模块('orderRecordStore.js');
const {
  工作流状态,
  读取工作流状态,
  读取本地处理阶段,
  读取后台开票状态,
  获取订单统计: 获取共享订单统计,
  筛选订单: 按人工阶段筛选订单,
  订单匹配搜索,
  是发票已登记待回传订单,
  是平台待开票待回传订单,
} = 加载共享模块('orderWorkflow.js');

const 订单备注字数上限 = 200;
const 跟进客服姓名字数上限 = 30;
const 已处理订单归档目录名 = '京东催促开票-已处理订单归档';
const 已处理归档索引字段名 = 'archivedHandledOrders';
const 已处理归档索引构建时间字段名 = 'handledArchiveIndexBuiltAt';
const 后台发票字段列表 = Object.freeze([
  'invoiceApplicationTime',
  'orderCompletionTime',
  'invoiceCountdownText',
  'invoiceTypeText',
  'invoiceAmountText',
  'invoiceTitle',
  'invoiceSource',
  'invoiceStatusText',
  'invoiceStatusKind',
  'invoiceBackendRowText',
]);

function 构建订单Key(storeId, orderNumber) {
  const normalizedStoreId = 规范化店铺标识(storeId);
  if (!normalizedStoreId) throw new Error('保存催票订单失败：店铺标识不能为空。');
  const normalizedOrderNumber = String(orderNumber || '').trim();
  if (!normalizedOrderNumber) throw new Error('保存催票订单失败：订单号不能为空。');
  return `${normalizedStoreId}:${normalizedOrderNumber}`;
}

function 规范化备注文本(value) {
  const text = String(value || '').trim();
  if (text.length > 订单备注字数上限) throw new Error(`保存备注失败：备注不能超过 ${订单备注字数上限} 个字。`);
  return text;
}

function 规范化跟进客服姓名(value) {
  const text = String(value || '').trim();
  if (text.length > 跟进客服姓名字数上限) throw new Error(`安排客服失败：客服姓名不能超过 ${跟进客服姓名字数上限} 个字。`);
  return text;
}

function 合并追加备注文本(existingNote, incomingNote) {
  const existing = 规范化备注文本(existingNote);
  const incoming = 规范化备注文本(incomingNote);
  if (!incoming) return existing;
  if (!existing) return incoming;
  return 规范化备注文本(`${existing}\n${incoming}`);
}

function 读取备份根目录(filePath, options = {}) {
  if (options.备份根目录) return path.resolve(options.备份根目录);
  if (path.resolve(filePath) === path.resolve(催票订单记录文件路径)) return 获取当前硬盘备份目录(项目根目录);
  return path.join(path.dirname(path.resolve(filePath)), 'backup');
}

function 构建迁移备份文件路径(sourcePath, now, backupRoot) {
  return path.join(
    backupRoot,
    `发票自动化-订单状态迁移-${格式化时间批次(now)}`,
    '2.京东发票回传',
    path.basename(sourcePath),
  );
}

function 构建已处理订单归档文件路径(sourcePath = 催票订单记录文件路径, options = {}) {
  const now = options.now || new Date();
  const backupRoot = 读取备份根目录(sourcePath, options);
  const sourceName = path.basename(sourcePath, path.extname(sourcePath)) || 'invoice-urge-orders';
  return path.join(backupRoot, 已处理订单归档目录名, 格式化时间批次(now), `${sourceName}-handled.json`);
}

function 创建京东订单仓库(filePath = 催票订单记录文件路径, options = {}) {
  const backupRoot = 读取备份根目录(filePath, options);
  const fixedNow = options.now instanceof Date ? options.now : null;
  return 创建订单记录仓库({
    filePath,
    archiveIndexFieldName: 已处理归档索引字段名,
    archiveBuiltAtFieldName: 已处理归档索引构建时间字段名,
    archiveRoot: path.join(backupRoot, 已处理订单归档目录名),
    importArchiveIndexBeforeSync: true,
    buildMigrationBackupPath: (sourcePath, now) => 构建迁移备份文件路径(sourcePath, now, backupRoot),
    buildArchivePath: (sourcePath, now) => 构建已处理订单归档文件路径(sourcePath, { ...options, now, 备份根目录: backupRoot }),
    nowProvider: fixedNow ? () => fixedNow : undefined,
  });
}

function 读取订单记录(filePath = 催票订单记录文件路径) {
  return 创建京东订单仓库(filePath).读取订单数据();
}

function 保存订单记录(orderData, filePath = 催票订单记录文件路径) {
  const migration = 迁移订单数据(orderData, {
    archiveIndexFieldName: 已处理归档索引字段名,
    archiveBuiltAtFieldName: 已处理归档索引构建时间字段名,
  });
  return 创建京东订单仓库(filePath).保存订单数据(migration.data);
}

function 记录转列表(orderData = null, filePath = 催票订单记录文件路径) {
  const repository = 创建京东订单仓库(filePath);
  return repository.记录转列表(orderData || repository.读取订单数据());
}

function 统计订单记录(orderData = null, filePath = 催票订单记录文件路径) {
  const counts = 获取共享订单统计(记录转列表(orderData, filePath));
  return {
    total: counts.total,
    pending: counts.pending,
    processing: counts.processing,
    invoiceRegistered: counts.invoiceRegistered,
    handled: counts.handled,
  };
}

function 获取订单统计(orderList = []) {
  const counts = 获取共享订单统计(orderList);
  return {
    total: counts.total,
    pending: counts.pending,
    processing: counts.processing,
    invoiceRegistered: counts.invoiceRegistered,
    handled: counts.handled,
  };
}

function 构建后台发票字段补丁(record, now) {
  const hasValue = 后台发票字段列表.some((fieldName) => String(record?.[fieldName] || '').trim());
  if (!hasValue) return {};
  return {
    invoiceApplicationTime: String(record.invoiceApplicationTime || ''),
    orderCompletionTime: String(record.orderCompletionTime || ''),
    invoiceCountdownText: String(record.invoiceCountdownText || ''),
    invoiceTypeText: String(record.invoiceTypeText || ''),
    invoiceAmountText: String(record.invoiceAmountText || ''),
    invoiceTitle: String(record.invoiceTitle || ''),
    invoiceSource: String(record.invoiceSource || ''),
    invoiceStatusText: String(record.invoiceStatusText || ''),
    invoiceStatusKind: String(record.invoiceStatusKind || 'unknown'),
    invoiceBackendRowText: String(record.invoiceBackendRowText || ''),
    invoiceBackendUpdatedAt: now,
    platformStatus: {
      kind: String(record.invoiceStatusKind || 'unknown'),
      text: String(record.invoiceStatusText || '未同步'),
      updatedAt: now,
    },
  };
}

function 构建扫描订单(store, record, now) {
  const orderNumber = String(record.orderNumber || '').trim();
  return {
    ...record,
    ...构建后台发票字段补丁(record, now),
    key: 构建订单Key(store.id, orderNumber),
    storeId: 规范化店铺标识(store.id),
    storeName: String(store.name || ''),
    orderNumber,
    summary: String(record.summary || `订单 ${orderNumber} 标记了催促开票`),
    rowText: String(record.rowText || ''),
    source: String(record.source || '页面催促开票标识'),
    addedAt: String(record.addedAt || now),
  };
}

function 记住扫描到的催票订单({ store, records }, filePath = 催票订单记录文件路径) {
  const repository = 创建京东订单仓库(filePath);
  const data = repository.读取订单数据();
  const 当前订单Keys = new Set((Array.isArray(records) ? records : [])
    .map((record) => 构建扫描订单(store, record, new Date().toISOString()).key));
  const storeId = 规范化店铺标识(store?.id);
  for (const [key, record] of Object.entries(data.orders || {})) {
    if (String(record.storeId || '').trim() === storeId && !当前订单Keys.has(key)) delete data.orders[key];
  }
  repository.保存订单数据(data);
  const now = new Date().toISOString();
  const result = repository.同步订单记录(
    (records || []).map((record) => 构建扫描订单(store, record, now)),
  );
  return result;
}

function 同步扫描到的发票订单信息({ store, invoiceOrders }, filePath = 催票订单记录文件路径) {
  const repository = 创建京东订单仓库(filePath);
  const data = repository.读取订单数据();
  const now = new Date().toISOString();
  let updatedCount = 0;
  for (const record of invoiceOrders || []) {
    if (!record?.orderNumber) continue;
    const key = 构建订单Key(store.id, record.orderNumber);
    if (!data.orders[key]) continue;
    const patch = 构建后台发票字段补丁(record, now);
    if (!Object.keys(patch).length) continue;
    repository.更新订单记录(key, { storeName: String(store.name || data.orders[key].storeName || ''), ...patch });
    updatedCount += 1;
  }
  const latest = repository.读取订单数据();
  return { updatedCount, records: repository.记录转列表(latest), stats: 统计订单记录(latest, filePath) };
}

function 手动新增待处理订单({ store, orderNumber, noteText = '' }, filePath = 催票订单记录文件路径) {
  if (!String(store?.id || '').trim()) throw new Error('手动新增订单失败：店铺不能为空。');
  const repository = 创建京东订单仓库(filePath);
  const key = 构建订单Key(store.id, orderNumber);
  const data = repository.读取订单数据();
  const existing = data.orders[key];
  if (existing) {
    const order = repository.更新订单记录(key, {
      storeName: String(store.name || existing.storeName || ''),
      noteText: 合并追加备注文本(existing.noteText, noteText),
    });
    const latest = repository.读取订单数据();
    return { created: false, order, records: repository.记录转列表(latest), stats: 统计订单记录(latest, filePath) };
  }
  const now = new Date().toISOString();
  const result = repository.同步订单记录([{
    key,
    storeId: 规范化店铺标识(store.id),
    storeName: String(store.name || ''),
    orderNumber: String(orderNumber || '').trim(),
    summary: `订单 ${String(orderNumber || '').trim()} 手动加入待处理`,
    rowText: `手动新增订单：${String(orderNumber || '').trim()}`,
    source: '手动新增待处理订单',
    noteText: 规范化备注文本(noteText),
    addedAt: now,
  }]);
  if (!result.addedRecords.length) {
    return { created: false, archived: true, order: null, ...result };
  }
  return { created: true, order: result.addedRecords[0], ...result };
}

function 读取指定订单(key, filePath) {
  const data = 创建京东订单仓库(filePath).读取订单数据();
  const order = data.orders[String(key || '').trim()];
  if (!order) throw new Error('更新催票订单失败：本地没有该订单，请先重新扫描。');
  return order;
}

function 转换到目标状态(key, targetStatus, filePath) {
  const repository = 创建京东订单仓库(filePath);
  const order = 读取指定订单(key, filePath);
  if (读取工作流状态(order) === targetStatus) return order;
  return repository.转换订单状态(key, targetStatus);
}

function 设置订单处理状态(key, handled, filePath = 催票订单记录文件路径) {
  return 转换到目标状态(key, handled ? 工作流状态.已处理 : 工作流状态.发票已登记, filePath);
}

function 更新订单工作流状态(key, targetStatus, filePath = 催票订单记录文件路径) {
  return 转换到目标状态(key, targetStatus, filePath);
}

function 设置订单处理中状态(key, processing, filePath = 催票订单记录文件路径) {
  return 转换到目标状态(key, processing ? 工作流状态.处理中 : 工作流状态.待处理, filePath);
}

function 设置订单发票登记状态(key, invoiceRegistered, filePath = 催票订单记录文件路径) {
  return 转换到目标状态(key, invoiceRegistered ? 工作流状态.发票已登记 : 工作流状态.处理中, filePath);
}

function 设置订单跟进客服(key, assigneeName, filePath = 催票订单记录文件路径) {
  const repository = 创建京东订单仓库(filePath);
  const normalizedName = 规范化跟进客服姓名(assigneeName);
  const existing = 读取指定订单(key, filePath);
  let updated = repository.更新订单记录(key, { assigneeName: normalizedName });
  if (normalizedName && 读取工作流状态(existing) === 工作流状态.待处理) {
    updated = repository.转换订单状态(key, 工作流状态.处理中);
  }
  return updated;
}

function 设置订单备注(key, noteText, filePath = 催票订单记录文件路径) {
  return 创建京东订单仓库(filePath).更新订单记录(key, { noteText: 规范化备注文本(noteText) });
}

function 批量标记开票成功已登记订单为已处理(filePath = 催票订单记录文件路径) {
  const repository = 创建京东订单仓库(filePath);
  const before = repository.读取订单数据();
  const targets = repository.记录转列表(before).filter((order) => (
    读取工作流状态(order) === 工作流状态.发票已登记
    && String(order.invoiceStatusKind || order.platformStatus?.kind || '') === 'success'
  ));
  for (const order of targets) repository.转换订单状态(order.key, 工作流状态.已处理);
  const latest = repository.读取订单数据();
  return { updatedCount: targets.length, records: repository.记录转列表(latest), stats: 统计订单记录(latest, filePath) };
}

function 设置订单回传尝试(key, attempt, filePath = 催票订单记录文件路径) {
  return 创建京东订单仓库(filePath).记录订单回传尝试(key, attempt);
}

function 设置订单发票回传成功(key, result = {}, filePath = 催票订单记录文件路径) {
  const repository = 创建京东订单仓库(filePath);
  repository.记录订单回传尝试(key, {
    status: 'success',
    message: String(result.message || '发票已回传到京东后台。'),
    invoiceFilePath: String(result.invoiceFilePath || ''),
    screenshotPath: String(result.screenshotPath || ''),
  });
  const now = new Date().toISOString();
  return repository.更新订单记录(key, {
    invoiceReturned: true,
    invoiceReturnedAt: now,
    invoiceReturnFilePath: String(result.invoiceFilePath || ''),
    invoiceReturnScreenshotPath: String(result.screenshotPath || ''),
    invoiceReturnMessage: String(result.message || '发票已回传到京东后台。'),
  });
}

function 导入已处理归档索引(orderData, filePath = 催票订单记录文件路径, options = {}) {
  return 创建京东订单仓库(filePath, options).导入已处理归档索引();
}

function 是否订单已存在或归档(orderData, key) {
  return Boolean(orderData?.orders?.[key] || orderData?.[已处理归档索引字段名]?.[key]);
}

function 归档清理已处理订单(filePath = 催票订单记录文件路径, options = {}) {
  return 创建京东订单仓库(filePath, options).归档已处理订单({ now: options.now });
}

function 是否已处理(order) {
  return 读取工作流状态(order) === 工作流状态.已处理;
}

function 是否已登记(order) {
  return [工作流状态.发票已登记, 工作流状态.已处理].includes(读取工作流状态(order));
}

function 是否处理中(order) {
  return 读取工作流状态(order) !== 工作流状态.待处理;
}

function 筛选订单(orderList, filterType) {
  const list = Array.isArray(orderList) ? orderList : [];
  if (filterType === 'backendSuccess') return list.filter((order) => 读取后台开票状态(order).kind === 'success');
  if (filterType === 'backendPending') return list.filter((order) => 读取后台开票状态(order).kind === 'pending');
  if (filterType === 'backendFailed') return list.filter((order) => ['failed', 'closed'].includes(读取后台开票状态(order).kind));
  return 按人工阶段筛选订单(list, filterType);
}

module.exports = {
  订单备注字数上限,
  跟进客服姓名字数上限,
  构建订单Key,
  规范化备注文本,
  规范化跟进客服姓名,
  合并追加备注文本,
  创建京东订单仓库,
  读取订单记录,
  保存订单记录,
  导入已处理归档索引,
  是否订单已存在或归档,
  构建已处理订单归档文件路径,
  归档清理已处理订单,
  记录转列表,
  统计订单记录,
  记住扫描到的催票订单,
  同步扫描到的发票订单信息,
  手动新增待处理订单,
  设置订单处理状态,
  更新订单工作流状态,
  批量标记开票成功已登记订单为已处理,
  设置订单处理中状态,
  设置订单跟进客服,
  设置订单发票登记状态,
  设置订单备注,
  设置订单回传尝试,
  设置订单发票回传成功,
  是否处理中,
  是否已登记,
  是否已处理,
  读取工作流状态,
  读取本地处理阶段,
  读取后台开票状态,
  获取订单统计,
  筛选订单,
  订单匹配搜索,
  是发票已登记待回传订单,
  是平台待开票待回传订单,
  工作流状态,
};
