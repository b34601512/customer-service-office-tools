const { 规范化订单列表, 获取批量订单列表 } = require('../invoices/orderList');
const { 查找本地发票, 记录已下载发票 } = require('../invoices/invoiceFileStore');
const { 批量查询并下载诺诺发票 } = require('./invoiceApiDownloader');

function 规范化订单号列表(orderNumbers) {
  // 这个函数解决调用方传入空值或重复订单号的问题。
  return 规范化订单列表(orderNumbers).map((order) => order.orderNumber);
}

function 构建缺失发票错误(缺失订单列表, 已找到发票列表) {
  // 这个函数解决第三方页面未确认时必须暴露真实缺口，而不是返回半真半假的结果。
  const error = new Error(`诺诺发票系统没有找到可下载发票，缺少 ${缺失订单列表.length} 张：${缺失订单列表.map((order) => order.orderNumber).join('、')}`);
  error.code = 'INVOICE_NOT_FOUND_IN_NUONUO';
  error.statusCode = 409;
  error.missingOrders = 缺失订单列表;
  error.localFiles = 已找到发票列表;
  return error;
}

async function 调用真实下载器(下载方法, 缺失订单列表, options) {
  // 这个函数解决未来确认诺诺页面后只替换底层下载方法，上层缓存和接口不用改。
  if (!缺失订单列表.length) return [];
  const 实际下载方法 = typeof 下载方法 === 'function' ? 下载方法 : 批量查询并下载诺诺发票;
  const 下载结果 = await 实际下载方法({
    orders: 缺失订单列表,
    invoiceSystemConfig: options.invoiceSystemConfig,
    headless: options.headless !== false,
    fileType: options.fileType || 'pdf',
  });
  return Array.isArray(下载结果) ? 下载结果 : [];
}

async function 批量下载发票(input = {}, options = {}) {
  // 这个函数解决各平台按订单号批量拿发票文件的问题，先复用本地文件，缺失再交给真实下载器。
  const 订单列表 = 获取批量订单列表(input);
  if (!订单列表.length) throw new Error('批量下载发票失败：没有可下载的订单号。');

  const 已找到发票列表 = [];
  const 缺失订单列表 = [];
  for (const order of 订单列表) {
    const 本地发票 = options.force ? null : 查找本地发票(order.orderNumber, options.indexFilePath);
    if (本地发票) {
      已找到发票列表.push({
        ...order,
        invoiceFilePath: 本地发票.invoiceFilePath,
        invoiceNumber: 本地发票.invoiceNumber || '',
        invoiceBuyerName: 本地发票.invoiceBuyerName || '',
        invoiceCode: 本地发票.invoiceCode || '',
        invoiceSubjectName: 本地发票.invoiceSubjectName || '',
        invoiceSubjectTaxNum: 本地发票.invoiceSubjectTaxNum || '',
        source: 本地发票.source,
      });
    } else {
      缺失订单列表.push(order);
    }
  }

  const 新下载结果 = await 调用真实下载器(options.providerDownloadMethod, 缺失订单列表, options);
  const 新下载发票列表 = 新下载结果.map((invoice) => {
    const 已登记发票 = 记录已下载发票(invoice, options.indexFilePath);
    const 原订单 = 缺失订单列表.find((order) => order.orderNumber === 已登记发票.orderNumber) || { orderNumber: 已登记发票.orderNumber };
    return { ...原订单, ...invoice, invoiceFilePath: 已登记发票.invoiceFilePath, source: 已登记发票.source };
  });

  const 已补齐订单号集合 = new Set(新下载发票列表.map((invoice) => invoice.orderNumber));
  const 仍缺失订单列表 = 缺失订单列表.filter((order) => !已补齐订单号集合.has(order.orderNumber));
  if (仍缺失订单列表.length) {
    throw 构建缺失发票错误(仍缺失订单列表, [...已找到发票列表, ...新下载发票列表]);
  }

  return 订单列表.map((order) => [...已找到发票列表, ...新下载发票列表]
    .find((invoice) => invoice.orderNumber === order.orderNumber));
}

module.exports = {
  规范化订单号列表,
  构建缺失发票错误,
  批量下载发票,
};
