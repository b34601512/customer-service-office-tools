const fs = require('fs');
const path = require('path');
const { 初始化运行目录, 写入JSON文件 } = require('../common/fs');
const { 打印日志 } = require('../common/logger');
const {
  截图目录,
  获取店铺快照文件路径,
} = require('../common/paths');
const {
  创建店铺浏览器上下文,
  保存店铺浏览器登录态,
} = require('../browser/storeBrowser');
const { 注册浏览器上下文, 关闭店铺浏览器上下文 } = require('../browser/browserContextHub');
const { 打开目标页面 } = require('../browser/openTargetPage');
const { 进入消费者发票页面 } = require('../consumerInvoice/enterConsumerInvoicePage');
const { 扫描消费者发票催促订单 } = require('../consumerInvoice/scanConsumerInvoiceUrges');
const { 发送桌面通知 } = require('../notify/sendDesktopNotification');
const { 规范化店铺配置 } = require('../store/storeConfigService');
const { 记住扫描到的催票订单, 同步扫描到的发票订单信息, 统计订单记录 } = require('../order/jdOrderRecordStore');
const { 验证凭证文件 } = require('../common/evidenceService');

async function 捕获失败页面诊断(page, 截图文件名, 指定失败截图路径 = '') {
  // 解决：失败时保留当场页面证据，避免只能凭一句超时错误猜原因。
  const 失败截图路径 = 指定失败截图路径
    || path.join(截图目录, 截图文件名.replace(/(\.[^.]+)?$/, '-failure$1'));
  const 诊断 = {
    pageTitle: '',
    pageUrl: '',
    pagePreview: '',
    screenshotPath: 失败截图路径,
  };

  try {
    诊断.pageTitle = await page.title();
  } catch {}

  try {
    诊断.pageUrl = page.url();
  } catch {}

  try {
    诊断.pagePreview = String(await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 1500);
  } catch {}

  try {
    await 保存轻量截图(page, 失败截图路径);
  } catch {
    诊断.screenshotPath = '';
  }

  return 诊断;
}

async function 保存轻量截图(page, 截图路径) {
  // 解决：只保存当前可见画面作为凭证，避免全页截图制造额外性能压力。
  fs.mkdirSync(path.dirname(截图路径), { recursive: true });
  await page.screenshot({
    path: 截图路径,
    fullPage: false,
  });
  验证凭证文件(截图路径);
}

function 附加失败页面诊断(错误, 诊断) {
  // 解决：把页面证据挂到错误对象上，让后台任务失败结果能写入本地结果文件。
  错误.pageDiagnostic = 诊断;
  return 错误;
}

async function 执行巡检(选项 = {}) {
  // 解决：串起浏览器、登录、催票识别和本地持久记录，形成完整闭环。
  const {
    headless = true,
    允许人工登录 = false,
    截图文件名 = 'latest-consumer-invoice-page.png',
    截图路径 = '',
    失败截图路径 = '',
    巡检后保持页面打开 = false,
    页面保留模式 = '',
    店铺配置 = null,
    onProgress = null,
  } = 选项;

  初始化运行目录();
  打印日志('催票巡检', '主流程', '开始执行京东常规开票催促识别');
  if (!店铺配置) {
    throw new Error('执行巡检失败：必须传入真实店铺配置，禁止使用默认店铺。');
  }

  const 当前店铺 = 规范化店铺配置(店铺配置);
  const 最终页面保留模式 = String(页面保留模式 || '').trim() || (巡检后保持页面打开 ? 'wait' : 'close');
  const 店铺快照路径 = 获取店铺快照文件路径(当前店铺.id);

  await 关闭店铺浏览器上下文(当前店铺.id);
  const context = await 创建店铺浏览器上下文({
    headless,
    店铺标识: 当前店铺.id,
    启动地址: 当前店铺.targetUrl,
  });
  注册浏览器上下文(context, {
    店铺名称: 当前店铺.name,
    店铺标识: 当前店铺.id,
  });
  let 浏览器已关闭 = false;
  context.once('close', () => {
    浏览器已关闭 = true;
  });

  const page = await 打开目标页面(context, 当前店铺.targetUrl);
  try {
    await 进入消费者发票页面(page, {
      允许人工登录,
      店铺配置: 当前店铺,
      目标地址: 当前店铺.targetUrl,
    });
    await 保存店铺浏览器登录态(context, context.__storeAuthStatePath);

    const 页面结果 = await 扫描消费者发票催促订单(page, 当前店铺, {
      onProgress,
    });
    const 持久化结果 = 记住扫描到的催票订单({
      store: 当前店铺,
      records: 页面结果.records,
    });
    const 新增催票记录 = 持久化结果.addedRecords || [];
    const 发票信息同步结果 = 同步扫描到的发票订单信息({
      store: 当前店铺,
      invoiceOrders: 页面结果.invoiceOrders,
    });
    const 当前截图路径 = 截图路径 || path.join(截图目录, 截图文件名);

    await 保存轻量截图(page, 当前截图路径);

    const 本地统计 = 统计订单记录();
    const 本次结果 = {
      storeId: 当前店铺.id,
      storeName: 当前店铺.name,
      storeEnabled: 当前店铺.enabled,
      checkedAt: new Date().toISOString(),
      pageTitle: 页面结果.pageTitle,
      pageUrl: 页面结果.pageUrl,
      pagePreview: 页面结果.pagePreview,
      metrics: {
        ...页面结果.metrics,
        actualPageSize: 页面结果.metrics.pageSize,
        backendInvoiceOrderCount: 页面结果.metrics.invoiceOrderCount || 0,
        backendInvoiceInfoUpdatedCount: 发票信息同步结果.updatedCount,
        backendInvoiceStatusCounts: 页面结果.metrics.invoiceStatusCounts || {},
        pendingOrderCount: 本地统计.pending,
        processingOrderCount: 本地统计.processing,
        invoiceRegisteredOrderCount: 本地统计.invoiceRegistered,
        handledOrderCount: 本地统计.handled,
        totalStoredOrderCount: 本地统计.total,
      },
      screenshotPath: 当前截图路径,
      records: 页面结果.records,
      newRecords: 新增催票记录,
      orderRecords: 发票信息同步结果.records || 持久化结果.records,
    };

    写入JSON文件(店铺快照路径, {
      checkedAt: 本次结果.checkedAt,
      pageTitle: 本次结果.pageTitle,
      pageUrl: 本次结果.pageUrl,
      metrics: 本次结果.metrics,
      records: 页面结果.records,
    });

    打印日志(
      '催票巡检',
      '主流程',
      `店铺=${当前店铺.name} 扫描页数=${页面结果.metrics.scannedPageCount ?? 1}，后台发票订单=${页面结果.metrics.invoiceOrderCount || 0}，已更新本地订单=${发票信息同步结果.updatedCount}，催票=${页面结果.records.length}，新增=${新增催票记录.length}，已归档忽略=${(持久化结果.skippedArchivedRecords || []).length}，本地待处理=${本地统计.pending}，处理中=${本地统计.processing}，发票已登记=${本地统计.invoiceRegistered}，已处理=${本地统计.handled}`,
    );

    if (新增催票记录.length > 0) {
      const 消息正文 = 新增催票记录
        .slice(0, 5)
        .map((记录, 索引) => `${索引 + 1}. ${记录.orderNumber}`)
        .join('\n');
      await 发送桌面通知(
        `京东催促开票「${当前店铺.name}」新增 ${新增催票记录.length} 个订单`,
        消息正文,
      );
    }

    if (最终页面保留模式 === 'wait') {
      await page.bringToFront().catch(() => {});
      打印日志('人工核对', '主流程', '页面已保持打开，请你直接核对；看完关闭浏览器窗口即可结束');
      await new Promise((resolve) => {
        context.once('close', resolve);
      });
    }

    if (最终页面保留模式 === 'keep') {
      await page.bringToFront().catch(() => {});
      打印日志('人工核对', '主流程', '页面已保持打开，当前店铺识别结果已写回后台，任务将继续执行下一家店铺');
    }

    return 本次结果;
  } catch (错误) {
    const 诊断 = await 捕获失败页面诊断(page, 截图文件名, 失败截图路径);
    打印日志(
      '催票巡检',
      '失败诊断',
      `店铺=${当前店铺.name}；标题=${诊断.pageTitle || '未知'}；URL=${诊断.pageUrl || '未知'}；截图=${诊断.screenshotPath || '截图失败'}；预览=${诊断.pagePreview.slice(0, 120)}`,
    );
    throw 附加失败页面诊断(错误, 诊断);
  } finally {
    if (!浏览器已关闭 && 最终页面保留模式 !== 'keep') {
      await context.close();
    }
  }
}

module.exports = {
  执行巡检,
};
