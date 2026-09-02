const { 打印日志 } = require('../common/logger');
const { 计算申请时间范围 } = require('./dateRange');
const { 捕获查询全部申请单请求 } = require('./signedInvoiceApiRequest');
const { 读取全部发票申请单 } = require('./invoiceApiReader');
const { 构建发票订单列表, 筛选催促订单, 统计发票状态 } = require('./invoiceApiMapper');

function 构建扫描指标(接口指标, invoiceOrders, records) {
  // 解决：统一生成后台需要的指标，避免主流程知道接口分页细节。
  return {
    ...接口指标,
    backendInvoiceOrderCount: invoiceOrders.length,
    invoiceOrderCount: invoiceOrders.length,
    urgedOrderCount: records.length,
    backendInvoiceStatusCounts: 统计发票状态(invoiceOrders),
    invoiceStatusCounts: 统计发票状态(invoiceOrders),
  };
}

async function 扫描消费者发票催促订单(page, 店铺配置 = {}, 选项 = {}) {
  // 解决：用京东内部接口 ckFlag 识别催促开票，彻底替代页面行文本识别。
  const 当前时间 = 选项.当前时间 || new Date();
  const 日期范围 = 计算申请时间范围(店铺配置.applicationDateRangeDays, 当前时间);
  打印日志('数据提取', '催票接口', `准备按申请时间读取：${日期范围.startDate} 至 ${日期范围.endDate}`);

  const 捕获请求 = await 捕获查询全部申请单请求(page);
  const 接口结果 = await 读取全部发票申请单(page, 捕获请求, 日期范围, {
    pageSize: 店铺配置.pageSize,
    onProgress: 选项.onProgress,
  });
  const invoiceOrders = 构建发票订单列表(接口结果.rows);
  const records = 筛选催促订单(invoiceOrders);

  打印日志('数据提取', '催票接口', `后台发票订单=${invoiceOrders.length}，催促开票订单=${records.length}`);
  return {
    pageTitle: await page.title().catch(() => ''),
    pageUrl: page.url(),
    pagePreview: '',
    metrics: 构建扫描指标(接口结果.metrics, invoiceOrders, records),
    invoiceOrders,
    records,
  };
}

module.exports = {
  扫描消费者发票催促订单,
};
