// 该文件用于只读取拼多多待回传订单报表并持久化，明确不下载发票、不上传也不提交。

const { 初始化运行目录, 确保目录存在 } = require('../common/fs');
const { 拼多多导出目录 } = require('../common/paths');
const { 创建拼多多店铺浏览器上下文 } = require('../browser/pddBrowserContext');
const {
  打开拼多多待回传发票页面,
  读取当前页待回传订单,
  导出拼多多待回传订单,
  读取拼多多导出订单,
} = require('../invoiceReturn/pddInvoicePage');
const { 同步待处理订单 } = require('../order/pddOrderRecordStore');

async function 读取拼多多订单快照(page, 店铺配置, dependencies) {
  const visibleOrders = await dependencies.读取当前页订单(page, 店铺配置);
  if (!visibleOrders.length) return { orders: [], exportFilePath: '', warning: '' };
  try {
    const exportFilePath = await dependencies.导出订单报表(page, 拼多多导出目录);
    return {
      orders: dependencies.读取订单报表(exportFilePath, 店铺配置),
      exportFilePath,
      warning: '',
    };
  } catch (error) {
    return {
      orders: visibleOrders,
      exportFilePath: '',
      warning: `完整报表读取失败，已保存当前可见订单：${error.message}`,
    };
  }
}

async function 同步拼多多待处理订单(options = {}) {
  const { 店铺配置, headless = false, 订单记录文件路径 = undefined } = options;
  if (!店铺配置?.id) throw new Error('同步拼多多待处理订单失败：缺少店铺配置。');
  const dependencies = {
    创建浏览器上下文: 创建拼多多店铺浏览器上下文,
    打开待回传页面: 打开拼多多待回传发票页面,
    读取当前页订单: 读取当前页待回传订单,
    导出订单报表: 导出拼多多待回传订单,
    读取订单报表: 读取拼多多导出订单,
    保存同步订单: 同步待处理订单,
    ...(options.依赖 || {}),
  };
  初始化运行目录();
  确保目录存在(拼多多导出目录);
  const context = await dependencies.创建浏览器上下文(店铺配置, { headless });
  try {
    const page = context.pages().find((item) => !item.isClosed()) || await context.newPage();
    await dependencies.打开待回传页面(page, 店铺配置);
    const snapshot = await 读取拼多多订单快照(page, 店铺配置, dependencies);
    const saved = await dependencies.保存同步订单({ store: 店铺配置, orders: snapshot.orders }, 订单记录文件路径);
    return {
      platformName: '拼多多',
      storeId: 店铺配置.id,
      storeName: 店铺配置.name,
      readOnly: true,
      orderCount: snapshot.orders.length,
      addedCount: saved.addedRecords.length,
      updatedCount: saved.updatedRecords.length,
      orders: snapshot.orders,
      stats: saved.stats,
      exportFilePath: snapshot.exportFilePath,
      warning: snapshot.warning,
      message: `拼多多「${店铺配置.name}」只读同步完成：读取 ${snapshot.orders.length} 单，新增 ${saved.addedRecords.length} 单。`,
    };
  } finally {
    // 同步只拥有本阶段的浏览器上下文；完成即释放，让紧随其后的正式回传接管同一店铺资料目录。
    await context.close();
  }
}

module.exports = { 读取拼多多订单快照, 同步拼多多待处理订单 };
