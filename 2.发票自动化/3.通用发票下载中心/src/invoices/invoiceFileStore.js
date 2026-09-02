const fs = require('fs');
const path = require('path');
const { 下载目录, 发票索引文件路径 } = require('../common/paths');
const { 确保目录存在, 读取JSON文件, 写入JSON文件 } = require('../common/fs');

const 发票文件扩展名集合 = new Set(['.pdf', '.ofd', '.xml', '.zip']);

function 清理文件名片段(value) {
  // 这个函数解决订单号进入 Windows 路径前必须剔除非法字符的问题。
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'invoice';
}

function 获取订单下载目录(orderNumber) {
  // 这个函数解决每个订单的发票文件物理隔离，避免同名文件互相覆盖。
  const 订单目录 = path.join(下载目录, 清理文件名片段(orderNumber));
  确保目录存在(订单目录);
  return 订单目录;
}

function 读取发票索引(indexFilePath = 发票索引文件路径) {
  // 这个函数解决下载中心重启后仍能知道订单号对应哪个本地发票文件。
  const 原始索引 = 读取JSON文件(indexFilePath, { invoices: {} });
  return {
    invoices: 原始索引 && typeof 原始索引.invoices === 'object' ? 原始索引.invoices : {},
  };
}

function 保存发票索引(index, indexFilePath = 发票索引文件路径) {
  // 这个函数解决发票索引统一 UTF-8 落盘，方便其它平台长期调用。
  写入JSON文件(indexFilePath, {
    invoices: index && typeof index.invoices === 'object' ? index.invoices : {},
  });
}

function 是可用发票文件(filePath) {
  // 这个函数解决索引可能指向过期路径的问题，调用前必须确认真实文件还存在。
  const 扩展名 = path.extname(String(filePath || '')).toLowerCase();
  return Boolean(filePath) && 发票文件扩展名集合.has(扩展名) && fs.existsSync(filePath);
}

function 从订单目录查找发票文件(orderNumber) {
  // 这个函数解决索引丢失时仍能从订单独立目录恢复已下载发票。
  const 订单目录 = 获取订单下载目录(orderNumber);
  const 候选文件列表 = fs.readdirSync(订单目录)
    .map((fileName) => path.join(订单目录, fileName))
    .filter(是可用发票文件)
    .sort();
  return 候选文件列表[0] || '';
}

function 记录已下载发票(invoice, indexFilePath = 发票索引文件路径) {
  // 这个函数解决任何下载器产物都必须进入统一索引，供所有平台复用。
  const orderNumber = String(invoice?.orderNumber || '').trim();
  const invoiceFilePath = String(invoice?.invoiceFilePath || '').trim();
  if (!orderNumber) throw new Error('登记发票文件失败：订单号不能为空。');
  if (!是可用发票文件(invoiceFilePath)) throw new Error(`登记发票文件失败：发票文件不存在或格式不支持：${invoiceFilePath}`);
  const index = 读取发票索引(indexFilePath);
  const record = {
    orderNumber,
    invoiceFilePath,
    source: String(invoice?.source || 'nuonuo').trim() || 'nuonuo',
    invoiceNumber: String(invoice?.invoiceNumber || '').trim(),
    invoiceCode: String(invoice?.invoiceCode || '').trim(),
    invoiceBuyerName: String(invoice?.invoiceBuyerName || '').trim(),
    invoiceSubjectName: String(invoice?.invoiceSubjectName || invoice?.nuonuoCompanyName || '').trim(),
    invoiceSubjectTaxNum: String(invoice?.invoiceSubjectTaxNum || invoice?.nuonuoCompanyTaxNum || '').trim(),
    updatedAt: new Date().toISOString(),
  };
  index.invoices[orderNumber] = record;
  保存发票索引(index, indexFilePath);
  return record;
}

function 查找本地发票(orderNumber, indexFilePath = 发票索引文件路径) {
  // 这个函数解决下载前先查本地缓存，避免重复登录第三方系统。
  const 标准订单号 = String(orderNumber || '').trim();
  if (!标准订单号) return null;
  const 索引记录 = 读取发票索引(indexFilePath).invoices[标准订单号];
  if (是可用发票文件(索引记录?.invoiceFilePath)) {
    return { ...索引记录, orderNumber: 标准订单号 };
  }
  const 恢复文件路径 = 从订单目录查找发票文件(标准订单号);
  if (!恢复文件路径) return null;
  return 记录已下载发票({
    orderNumber: 标准订单号,
    invoiceFilePath: 恢复文件路径,
    source: 'local-recovered',
  }, indexFilePath);
}

function 登记本地发票文件({
  orderNumber,
  invoiceFilePath,
  source = 'manual-import',
  invoiceNumber = '',
  invoiceCode = '',
  invoiceBuyerName = '',
  invoiceSubjectName = '',
  invoiceSubjectTaxNum = '',
}, indexFilePath = 发票索引文件路径) {
  // 这个函数解决人工或其它下载器已有文件接入下载中心的问题，不强迫重复下载。
  const 标准订单号 = String(orderNumber || '').trim();
  const 原文件路径 = String(invoiceFilePath || '').trim();
  if (!标准订单号) throw new Error('导入本地发票失败：订单号不能为空。');
  if (!是可用发票文件(原文件路径)) throw new Error(`导入本地发票失败：文件不存在或格式不支持：${原文件路径}`);
  const 扩展名 = path.extname(原文件路径).toLowerCase();
  const 目标文件路径 = path.join(获取订单下载目录(标准订单号), `${清理文件名片段(标准订单号)}${扩展名}`);
  if (path.resolve(原文件路径) !== path.resolve(目标文件路径)) {
    fs.copyFileSync(原文件路径, 目标文件路径);
  }
  return 记录已下载发票({
    orderNumber: 标准订单号,
    invoiceFilePath: 目标文件路径,
    source,
    invoiceNumber,
    invoiceCode,
    invoiceBuyerName,
    invoiceSubjectName,
    invoiceSubjectTaxNum,
  }, indexFilePath);
}

function 列出本地发票(indexFilePath = 发票索引文件路径) {
  // 这个函数解决调试和平台联调用时能快速查看当前下载中心已有发票。
  return Object.values(读取发票索引(indexFilePath).invoices)
    .filter((record) => 是可用发票文件(record.invoiceFilePath))
    .sort((a, b) => String(a.orderNumber).localeCompare(String(b.orderNumber)));
}

module.exports = {
  清理文件名片段,
  获取订单下载目录,
  读取发票索引,
  保存发票索引,
  查找本地发票,
  记录已下载发票,
  登记本地发票文件,
  列出本地发票,
};
