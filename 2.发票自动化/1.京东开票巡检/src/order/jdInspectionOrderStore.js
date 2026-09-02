// 该文件用于把京东开票巡检明细和旧网页三阶段状态迁入共享四阶段仓库，并保留备注与客户档案。

const fs = require('node:fs');
const path = require('node:path');
const {
  发票处理状态文件路径,
  项目根目录,
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
  格式化时间批次,
} = 加载共享模块('orderRecordStore.js');
const {
  工作流状态,
  规范化工作流状态,
  读取工作流状态,
  读取本地处理阶段,
  读取平台状态,
  获取订单统计,
  筛选订单,
  订单匹配搜索,
} = 加载共享模块('orderWorkflow.js');

const 备注字数上限 = 500;
const 联系人字数上限 = 80;

function 规范化文本(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' | ')
    .trim();
}

function 校验长度(fieldName, text, maxLength) {
  if (text.length > maxLength) throw new Error(`${fieldName}不能超过 ${maxLength} 个字。`);
}

function 规范化备注(value) {
  const text = String(value ?? '').trim();
  校验长度('订单备注', text, 备注字数上限);
  return text;
}

function 规范化联系人(value) {
  const text = String(value ?? '').trim();
  校验长度('订单是谁', text, 联系人字数上限);
  return text;
}

function 取记录字段(record = {}, fieldNames = []) {
  const sources = [record.fields && typeof record.fields === 'object' ? record.fields : {}, record];
  for (const source of sources) {
    for (const fieldName of fieldNames) {
      const value = source?.[fieldName];
      if (value !== undefined && value !== null && String(value).trim()) return 规范化文本(value);
    }
  }
  return '';
}

function 取记录合并文本(record = {}) {
  const fields = record.fields && typeof record.fields === 'object' ? record.fields : {};
  return `${record.summary || ''} | ${Object.values(fields).join(' | ')}`;
}

function 取发票上传倒计时文本(record = {}) {
  const sources = [record, record.fields && typeof record.fields === 'object' ? record.fields : {}];
  for (const source of sources) {
    const key = Object.keys(source || {}).find((name) => /发票上传.*倒计时/.test(name) && !/开始时间/.test(name));
    if (key) return 规范化文本(source[key]);
  }
  return '';
}

function 识别距离逾期天数(text = '') {
  const matched = String(text || '').match(/还有\s*(\d+)\s*天逾期/);
  return matched ? Number(matched[1]) : null;
}

function 识别开票明细状态(record = {}) {
  const mergedText = 取记录合并文本(record);
  const countdownText = 取发票上传倒计时文本(record);
  const checkText = countdownText || mergedText;
  if (countdownText === '未逾期') return { 状态: '已上传未逾期', 需要登记: false, 需要预警: false, 优先级: '低' };
  if (/已逾期|超期/.test(checkText)) return { 状态: '待登记已逾期', 需要登记: true, 需要预警: true, 优先级: '高' };
  const daysLeft = 识别距离逾期天数(checkText);
  if (daysLeft !== null) {
    return {
      状态: daysLeft <= 5 ? '待登记即将逾期' : '待登记未到预警期',
      需要登记: true,
      需要预警: daysLeft <= 5,
      优先级: daysLeft <= 5 ? '高' : '中',
    };
  }
  if (/即将逾期|剩余处理时间不足\s*5\s*天/.test(checkText)) return { 状态: '待登记即将逾期', 需要登记: true, 需要预警: true, 优先级: '高' };
  if (!countdownText && /(^|[；|:\s])未逾期($|[；|:\s])/.test(mergedText)) return { 状态: '已上传未逾期', 需要登记: false, 需要预警: false, 优先级: '低' };
  if (/待处理|待登记|去开票/.test(mergedText)) return { 状态: '待登记待确认', 需要登记: true, 需要预警: false, 优先级: '中' };
  return { 状态: '已记录待确认', 需要登记: false, 需要预警: false, 优先级: '低' };
}

function 取订单编号(record = {}) {
  return 取记录字段(record, ['销售订单编号', '订单号', '订单编号', 'orderNo', 'orderId'])
    || String(record.id || '').slice(0, 12)
    || '未知订单';
}

function 构建订单键(storeResult = {}, record = {}) {
  const storeId = String(storeResult.storeId || storeResult.storeName || 'unknown-store').trim();
  const recordId = String(record.id || 取订单编号(record) || record.summary || '').trim();
  if (!recordId) throw new Error('同步巡检订单失败：订单记录缺少稳定标识。');
  return `${storeId}::${recordId}`;
}

function 读取备份根目录(filePath) {
  if (path.resolve(filePath) === path.resolve(发票处理状态文件路径)) {
    return path.join(path.parse(path.resolve(项目根目录)).root, '备份文件夹');
  }
  return path.join(path.dirname(path.resolve(filePath)), 'backup');
}

function 创建巡检订单仓库(filePath = 发票处理状态文件路径) {
  const backupRoot = 读取备份根目录(filePath);
  return 创建订单记录仓库({
    filePath,
    buildMigrationBackupPath: (sourcePath, now) => path.join(
      backupRoot,
      `发票自动化-订单状态迁移-${格式化时间批次(now)}`,
      '1.京东开票巡检',
      path.basename(sourcePath),
    ),
  });
}

function 读取订单数据(filePath = 发票处理状态文件路径) {
  return 创建巡检订单仓库(filePath).读取订单数据();
}

function 补齐稀疏订单展示字段(order = {}) {
  const fallback = String(order.key || order.orderKey || '').split('::').at(-1) || '';
  return { ...order, orderKey: order.orderKey || order.key, orderNumber: order.orderNumber || fallback };
}

function 读取订单列表(filePath = 发票处理状态文件路径) {
  const repository = 创建巡检订单仓库(filePath);
  return repository.记录转列表(repository.读取订单数据()).map(补齐稀疏订单展示字段);
}

function 构建巡检订单快照(storeResult, record, detailStatus) {
  const key = 构建订单键(storeResult, record);
  return {
    key,
    orderKey: key,
    recordId: String(record.id || ''),
    orderNumber: 取订单编号(record),
    storeId: String(storeResult.storeId || ''),
    storeName: String(storeResult.storeName || storeResult.storeId || '未命名店铺'),
    lastCheckedAt: String(storeResult.lastCheckedAt || ''),
    source: String(record.source || '页面表格'),
    summary: String(record.summary || ''),
    fields: record.fields && typeof record.fields === 'object' ? { ...record.fields } : {},
    detailStatus,
    platformStatus: {
      kind: detailStatus.需要登记 ? 'needs_registration' : 'recorded',
      text: detailStatus.状态,
      updatedAt: String(storeResult.lastCheckedAt || new Date().toISOString()),
    },
  };
}

function 同步巡检店铺结果(storeResult = {}, filePath = 发票处理状态文件路径) {
  const repository = 创建巡检订单仓库(filePath);
  const current = repository.读取订单数据();
  const 当前记录 = Array.isArray(storeResult.records) ? storeResult.records : [];
  const 当前订单Keys = new Set(当前记录.map((record) => 构建订单键(storeResult, record)));
  const storeId = String(storeResult.storeId || '').trim();
  for (const [key, record] of Object.entries(current.orders || {})) {
    if (String(record.storeId || '').trim() === storeId && !当前订单Keys.has(key)) delete current.orders[key];
  }
  repository.保存订单数据(current);
  const incoming = [];
  for (const record of 当前记录) {
    const detailStatus = 识别开票明细状态(record);
    const key = 构建订单键(storeResult, record);
    if (!detailStatus.需要登记 && !current.orders[key]) continue;
    incoming.push(构建巡检订单快照(storeResult, record, detailStatus));
  }
  return repository.同步订单记录(incoming);
}

function 同步最近巡检结果(resultObject = {}, filePath = 发票处理状态文件路径) {
  const stores = Array.isArray(resultObject)
    ? resultObject
    : Object.values(resultObject?.stores || {});
  let addedCount = 0;
  let updatedCount = 0;
  for (const storeResult of stores) {
    const result = 同步巡检店铺结果(storeResult, filePath);
    addedCount += result.addedRecords.length;
    updatedCount += result.updatedRecords.length;
  }
  const orders = 读取订单列表(filePath);
  return { addedCount, updatedCount, records: orders, stats: 获取订单统计(orders) };
}

function 更新订单工作流状态(key, targetStatus, filePath = 发票处理状态文件路径) {
  return 创建巡检订单仓库(filePath).转换订单状态(key, 规范化工作流状态(targetStatus));
}

function 设置订单备注(key, noteText, filePath = 发票处理状态文件路径) {
  return 创建巡检订单仓库(filePath).更新订单记录(key, { noteText: 规范化备注(noteText) });
}

function 设置订单客户档案(key, profile = {}, filePath = 发票处理状态文件路径) {
  return 创建巡检订单仓库(filePath).更新订单记录(key, {
    contactName: 规范化联系人(profile.contactName),
    orderNoteText: 规范化备注(profile.orderNoteText),
  });
}

module.exports = {
  备注字数上限,
  联系人字数上限,
  规范化文本,
  规范化备注,
  规范化联系人,
  取记录字段,
  识别开票明细状态,
  取订单编号,
  构建订单键,
  创建巡检订单仓库,
  读取订单数据,
  读取订单列表,
  构建巡检订单快照,
  同步巡检店铺结果,
  同步最近巡检结果,
  更新订单工作流状态,
  设置订单备注,
  设置订单客户档案,
  工作流状态,
  读取工作流状态,
  读取本地处理阶段,
  读取平台状态,
  获取订单统计,
  筛选订单,
  订单匹配搜索,
};
