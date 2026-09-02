const fs = require('node:fs');
const path = require('path');
const { 初始化运行目录, 确保目录存在 } = require('../common/fs');
const { 运行目录 } = require('../common/paths');
const { 打印日志 } = require('../common/logger');
const { 创建拼多多店铺浏览器上下文 } = require('../browser/pddBrowserContext');
const { 批量从下载中心下载发票 } = require('../invoiceReturn/downloadCenterInvoiceDownloader');
const {
  打开拼多多待回传发票页面,
  导出拼多多待回传订单,
  读取拼多多导出订单,
  保存拼多多回传截图,
  上传单张拼多多发票,
  重置拼多多待回传列表页面,
} = require('../invoiceReturn/pddInvoicePage');
const {
  读取订单列表,
  设置订单回传尝试,
} = require('../order/pddOrderRecordStore');

const 正式回传闸门模块路径 = [
  path.resolve(__dirname, '../../../共享发票回传/formalReturnGate.js'),
  path.resolve(__dirname, '../../共享发票回传/formalReturnGate.js'),
].find((模块路径) => fs.existsSync(模块路径));
if (!正式回传闸门模块路径) throw new Error('找不到共享正式回传闸门模块。');
const {
  创建正式回传闸门,
  执行受控正式回传,
} = require(正式回传闸门模块路径);

const 拼多多回传导出目录 = path.join(运行目录, 'pdd-exports');
const 下载中心常见返回秒数 = 30;

function 是发票未找到错误(错误) {
  // 解决：下载中心确认发票还没开好时，批量流程跳过当前订单继续处理。
  const code = String(错误?.code || 错误?.response?.code || '').trim();
  const message = String(错误?.message || '').trim();
  return code === 'INVOICE_NOT_FOUND_IN_NUONUO' || message.includes('诺诺发票系统没有找到可下载发票');
}

function 通知回传进度(onProgress, progress) {
  // 解决：主流程只通过一个回调出口通知控制台，避免 UI 状态来源分裂。
  if (typeof onProgress === 'function') {
    onProgress({
      ...progress,
      updatedAt: new Date().toISOString(),
    });
  }
}

function 格式化动作等待秒数(startedAt) {
  // 解决：长动作反馈只展示粗粒度等待时间，避免一秒一刷制造噪声。
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

async function 执行带持续进度反馈(选项 = {}) {
  // 解决：导出、下载、上传这类黑箱等待必须持续告诉用户当前动作。
  const {
    action,
    onProgress = null,
    buildProgress,
    intervalMs = 5000,
  } = 选项;
  if (typeof action !== 'function') {
    throw new Error('持续进度反馈失败：缺少要执行的动作。');
  }
  if (typeof onProgress !== 'function' || typeof buildProgress !== 'function') {
    return action();
  }
  const startedAt = Date.now();
  const 推送当前进度 = () => {
    const progress = buildProgress(格式化动作等待秒数(startedAt));
    if (progress) 通知回传进度(onProgress, progress);
  };
  推送当前进度();
  const timer = setInterval(推送当前进度, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    return await action();
  } finally {
    clearInterval(timer);
  }
}

function 构建阶段进度(message) {
  // 解决：非订单级动作也能刷新弹窗摘要，不必等订单列表生成。
  return {
    type: 'stage',
    status: 'running',
    message,
  };
}

function 构建回传报告订单(order) {
  // 解决：前端报告只展示订单和店铺身份，不暴露店铺登录配置。
  return {
    key: order.key,
    storeId: order.storeId,
    storeName: order.storeName,
    orderNumber: order.orderNumber,
    invoiceAmount: order.invoiceAmount,
    invoiceType: order.invoiceType,
    invoiceApplyTime: order.invoiceApplyTime,
    promisedInvoiceTime: order.promisedInvoiceTime,
    financeIssueReference: order.financeIssueReference,
    invoiceTitle: order.invoiceTitle,
    invoiceNumber: order.invoiceNumber,
    invoiceFilePath: order.invoiceFilePath,
  };
}

function 构建下载中心等待反馈(index, total, 等待秒数) {
  // 解决：下载中心接口没有实时内部进度时，也要持续告诉用户当前等待是否正常。
  const remainSeconds = Math.max(0, 下载中心常见返回秒数 - 等待秒数);
  const waitText = 等待秒数 < 下载中心常见返回秒数
    ? `通常 ${下载中心常见返回秒数} 秒内返回，预计还需约 ${remainSeconds} 秒。`
    : `已超过常见 ${下载中心常见返回秒数} 秒，仍在等待下载中心返回。`;
  return `下载中心正在处理第 ${index + 1}/${total} 张发票，已等待 ${等待秒数} 秒。${waitText}`;
}

function 拼接财务参考到跳过原因(order, message) {
  // 解决：下载中心没找到发票时，把申请时间参考一起留在当前订单行里。
  const financeReference = String(order.financeIssueReference || '').trim();
  return financeReference ? `${message}｜${financeReference}。` : message;
}

function 合并下载中心发票字段(order, download) {
  // 解决：拼多多回填必须用下载中心返回的发票号码，不能只保存文件路径。
  return {
    ...order,
    invoiceFilePath: String(download.invoiceFilePath || '').trim(),
    invoiceNumber: String(download.invoiceNumber || order.invoiceNumber || '').trim(),
    invoiceCode: String(download.invoiceCode || order.invoiceCode || '').trim(),
  };
}

async function 保存下载阶段凭证截图(page, order, 状态文本) {
  // 解决：下载中心没找到发票或下载失败也必须留页面凭证，不能只在上传阶段截图。
  if (!page) return '';
  return 保存拼多多回传截图(page, order, 状态文本).catch(() => '');
}

async function 逐单下载拼多多发票(orders, 选项 = {}) {
  // 解决：逐单调用公共下载中心，未开好的订单跳过，已下载的订单进入上传阶段。
  const {
    page = null,
    批量下载发票方法 = 批量从下载中心下载发票,
    onProgress = null,
    progressIntervalMs = 5000,
  } = 选项;
  const 下载结果 = [];
  for (const [index, order] of orders.entries()) {
    const reportItem = 构建回传报告订单(order);
    try {
      const downloadList = await 执行带持续进度反馈({
        onProgress,
        intervalMs: progressIntervalMs,
        action: () => 批量下载发票方法({ orders: [order], force: true }),
        buildProgress: (等待秒数) => ({
          type: 'item',
          status: 'downloading',
          message: 构建下载中心等待反馈(index, orders.length, 等待秒数),
          item: reportItem,
        }),
      });
      const download = Array.isArray(downloadList) ? downloadList[0] : null;
      if (!download?.invoiceFilePath) {
        throw new Error(`下载中心没有返回订单 ${order.orderNumber} 的发票文件。`);
      }
      const merged = 合并下载中心发票字段(order, download);
      下载结果.push(merged);
      通知回传进度(onProgress, {
        type: 'item',
        status: 'downloaded',
        message: `发票文件已下载：${merged.invoiceFilePath}`,
        item: 构建回传报告订单(merged),
      });
    } catch (错误) {
      if (是发票未找到错误(错误)) {
        const screenshotPath = await 保存下载阶段凭证截图(page, order, 'skipped');
        通知回传进度(onProgress, {
          type: 'item',
          status: 'skipped',
          message: 拼接财务参考到跳过原因(order, `已跳过：下载中心没有找到可下载发票。${错误.message}`),
          item: { ...构建回传报告订单(order), screenshotPath },
        });
        continue;
      }
      const screenshotPath = await 保存下载阶段凭证截图(page, order, 'download-error');
      通知回传进度(onProgress, {
        type: 'item',
        status: 'error',
        message: `下载失败：${错误.message}`,
        item: { ...构建回传报告订单(order), screenshotPath },
      });
    }
  }
  return 下载结果;
}

async function 上传已下载拼多多发票(page, downloads, 选项 = {}) {
  // 解决：上传阶段只处理已有本地发票路径的订单，不参与下载判断。
  const {
    submit = false,
    onProgress = null,
    progressIntervalMs = 5000,
  } = 选项;
  const 上传结果 = [];
  for (const [index, item] of downloads.entries()) {
    const reportItem = 构建回传报告订单(item);
    try {
      const uploadResult = await 执行带持续进度反馈({
        onProgress,
        intervalMs: progressIntervalMs,
        action: () => 上传单张拼多多发票({
          page,
          order: item,
          invoiceFilePath: item.invoiceFilePath,
          invoiceNumber: item.invoiceNumber,
          invoiceCode: item.invoiceCode,
          submit,
          onAction: (message) => 通知回传进度(onProgress, {
            type: 'item',
            status: 'uploading',
            message,
            item: reportItem,
          }),
        }),
        buildProgress: (等待秒数) => ({
          type: 'item',
          status: 'uploading',
          message: `正在回传第 ${index + 1}/${downloads.length} 张发票，已等待 ${等待秒数} 秒。`,
          item: reportItem,
        }),
      });
      上传结果.push({ ...item, ...uploadResult, status: 'success' });
      通知回传进度(onProgress, {
        type: 'item',
        status: submit ? 'success' : 'uploaded',
        message: submit ? '拼多多发票已确认回传。' : '拼多多发票已上传并填好号码，未点击确认。',
        item: {
          ...构建回传报告订单(item),
          invoiceNumber: uploadResult.invoiceNumber,
          screenshotPath: uploadResult.screenshotPath,
        },
      });
    } catch (错误) {
      上传结果.push({
        ...item,
        status: 'error',
        errorMessage: 错误.message,
        screenshotPath: 错误.screenshotPath || '',
      });
      通知回传进度(onProgress, {
        type: 'item',
        status: 'error',
        message: `回传失败：${错误.message}`,
        item: {
          ...构建回传报告订单(item),
          screenshotPath: 错误.screenshotPath || '',
        },
      });
      if (index < downloads.length - 1) {
        await 重置拼多多待回传列表页面(page);
      }
    }
  }
  return 上传结果;
}

async function 执行拼多多发票回传(选项 = {}) {
  // 解决：完整执行导出、下载、上传和正式确认回传，所有业务入口统一正式回传。
  const {
    店铺配置,
    headless = false,
    批量下载发票方法 = 批量从下载中心下载发票,
    onProgress = null,
    orders: 指定订单列表 = null,
  } = 选项;
  if (!店铺配置?.id) throw new Error('拼多多发票回传失败：缺少店铺配置。');
  初始化运行目录();
  确保目录存在(拼多多回传导出目录);
  const context = await 创建拼多多店铺浏览器上下文(店铺配置, { headless });
  try {
    const page = context.pages().find((item) => !item.isClosed()) || await context.newPage();
    await 执行带持续进度反馈({
      onProgress,
      action: () => 打开拼多多待回传发票页面(page, 店铺配置),
      buildProgress: (等待秒数) => 构建阶段进度(`正在打开拼多多待开票列表：${店铺配置.name}，已等待 ${等待秒数} 秒。`),
    });
    const 使用本地已登记订单 = Array.isArray(指定订单列表);
    const exportFilePath = 使用本地已登记订单 ? '' : await 执行带持续进度反馈({
      onProgress,
      action: () => 导出拼多多待回传订单(page, 拼多多回传导出目录, {
        onAction: (message) => 通知回传进度(onProgress, 构建阶段进度(message)),
      }),
      buildProgress: (等待秒数) => 构建阶段进度(`正在批量导出拼多多待回传订单，已等待 ${等待秒数} 秒。`),
    });
    if (exportFilePath) 打印日志('拼多多发票回传', '导出订单', `已导出待回传订单：${exportFilePath}`);
    通知回传进度(onProgress, 构建阶段进度(
      使用本地已登记订单 ? '正在读取本地发票已登记订单。' : '正在读取拼多多待回传订单报表。',
    ));
    const orders = 使用本地已登记订单
      ? [...指定订单列表]
      : 读取拼多多导出订单(exportFilePath, 店铺配置);
    if (!orders.length) {
      const message = '已跳过：导出报表没有可回传订单。';
      打印日志('拼多多发票回传', '读取订单', message);
      return {
        message,
        exportFilePath,
        totalCount: 0,
        downloadedCount: 0,
        uploadedCount: 0,
        failedCount: 0,
        submitted: true,
        orders: [],
        uploads: [],
      };
    }
    通知回传进度(onProgress, {
      type: 'orders',
      status: 'running',
      message: `已读取拼多多待回传订单 ${orders.length} 单。`,
      exportFilePath,
      items: orders.map(构建回传报告订单),
    });
    const downloads = await 逐单下载拼多多发票(orders, { page, 批量下载发票方法, onProgress });
    const uploads = await 上传已下载拼多多发票(page, downloads, { submit: true, onProgress });
    const successCount = uploads.filter((item) => item.status !== 'error').length;
    const failedCount = uploads.filter((item) => item.status === 'error').length + orders.length - downloads.length;
    const message = `拼多多发票回传完成：成功 ${successCount}/${orders.length} 单，失败或跳过 ${failedCount} 单。`;
    return {
      message,
      exportFilePath,
      totalCount: orders.length,
      downloadedCount: downloads.length,
      uploadedCount: successCount,
      failedCount,
      submitted: true,
      orders,
      uploads,
    };
  } finally {
    // 浏览器保持打开，供人工核实；用户看完手动关闭窗口即可。
  }
}

async function 执行拼多多发票正式回传(选项 = {}) {
  // 解决：正式入口只消费本地已同步待回传队列（拼多多没有“发票已登记”人工阶段），逐单留痕并提交。
  const gate = 创建正式回传闸门({
    store: 选项.店铺配置,
    orders: 选项.orders,
    要求已登记: 选项.要求已登记 !== false,
    读取本地订单列表: 选项.读取本地订单列表方法 || 读取订单列表,
    记录订单回传尝试: 选项.记录订单回传尝试方法 || 设置订单回传尝试,
    onProgress: 选项.onProgress,
  });
  return 执行受控正式回传({
    platformName: '拼多多',
    store: 选项.店铺配置,
    gate,
    execute: (orders, onProgress) => (选项.执行回传方法 || 执行拼多多发票回传)({ ...选项, orders, onProgress }),
  });
}

module.exports = {
  拼多多回传导出目录,
  是发票未找到错误,
  通知回传进度,
  构建回传报告订单,
  构建下载中心等待反馈,
  拼接财务参考到跳过原因,
  合并下载中心发票字段,
  保存下载阶段凭证截图,
  执行带持续进度反馈,
  构建阶段进度,
  逐单下载拼多多发票,
  上传已下载拼多多发票,
  执行拼多多发票回传,
  执行拼多多发票正式回传,
};
