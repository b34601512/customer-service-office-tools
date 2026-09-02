// 该文件用于只打开天猫待回传列表、读取订单并持久化，明确不下载发票、不上传也不提交。

const { 初始化运行目录, 确保目录存在 } = require('../common/fs');
const { 天猫导出目录 } = require('../common/paths');
const { 创建天猫店铺浏览器上下文 } = require('../browser/tmallBrowserContext');
const {
  打开天猫待回传发票页面,
  读取当前页待回传订单,
  导出天猫待回传订单,
} = require('../invoiceReturn/tmallInvoicePage');
const { 同步待处理订单 } = require('../order/tmallOrderRecordStore');

async function 同步天猫待处理订单(options = {}) {
  const { 店铺配置, headless = false, 订单记录文件路径 = undefined } = options;
  if (!店铺配置?.id) throw new Error('同步天猫待处理订单失败：缺少店铺配置。');
  const dependencies = {
    创建浏览器上下文: 创建天猫店铺浏览器上下文,
    打开待回传页面: 打开天猫待回传发票页面,
    读取待回传订单: 读取当前页待回传订单,
    导出订单留痕: 导出天猫待回传订单,
    保存同步订单: 同步待处理订单,
    ...(options.依赖 || {}),
  };
  初始化运行目录();
  确保目录存在(天猫导出目录);
  const context = await dependencies.创建浏览器上下文(店铺配置, { headless });
  try {
    const page = context.pages().find((item) => !item.isClosed()) || await context.newPage();
    await dependencies.打开待回传页面(page, 店铺配置);
    const orders = await dependencies.读取待回传订单(page, 店铺配置);
    let exportFilePath = '';
    let warning = '';
    if (orders.length) {
      try {
        exportFilePath = await dependencies.导出订单留痕(page, 天猫导出目录);
      } catch (error) {
        warning = `订单已保存，但导出留痕失败：${error.message}`;
      }
    }
    const saved = await dependencies.保存同步订单({ store: 店铺配置, orders }, 订单记录文件路径);
    return {
      platformName: '天猫',
      storeId: 店铺配置.id,
      storeName: 店铺配置.name,
      readOnly: true,
      orderCount: orders.length,
      addedCount: saved.addedRecords.length,
      updatedCount: saved.updatedRecords.length,
      orders,
      stats: saved.stats,
      exportFilePath,
      warning,
      message: `天猫「${店铺配置.name}」只读同步完成：读取 ${orders.length} 单，新增 ${saved.addedRecords.length} 单。`,
    };
  } finally {
    // 同步与正式回传复用同一个浏览器上下文；下载和回传完成后继续保持打开供人工核实。
  }
}

module.exports = { 同步天猫待处理订单 };
