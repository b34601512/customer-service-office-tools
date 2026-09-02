// 该文件用于把三平台只读同步、四个直接队列、多店失败继续、逐单进度和汇总报告统一接回 CLI。

const { 选择店铺 } = require('./命令行核心');
const {
  打开订单状态管理,
  构建四队列统计文字,
} = require('./订单状态菜单');
const {
  执行多店铺发票回传,
} = require('../共享发票回传/batchReturnRunner');

const 最终回传状态 = new Set(['success', 'skipped', 'error']);
const 结果页店铺上限 = 10;

function 记录工作台日志(context, message) {
  // 多店和逐单明细直接输出到执行页面，同时保留诊断通道供页面重绘时追溯。
  console.log(message);
  if (typeof context?.记录运行日志 === 'function') context.记录运行日志(message);
}

function 显示工作台页面(context, title, subtitle = '', lines = []) {
  // 高频任务进度采用整页重绘，因此运行十家店也不会形成滚动日志墙。
  if (typeof context?.终端?.显示页面 === 'function') {
    context.终端.显示页面(title, subtitle);
  } else {
    context?.终端?.清屏?.();
    if (typeof context?.终端?.输出标题 === 'function') context.终端.输出标题(title, subtitle);
    else context.输出(`[页面] ${title}${subtitle ? `｜${subtitle}` : ''}`);
  }
  for (const line of lines) context.输出(line);
}

function 格式化同步店铺行(report = {}) {
  if (report.status === 'success') {
    return `[成功] ${report.storeName}｜读取 ${Number(report.orderCount || 0)} 单｜新增 ${Number(report.addedCount || 0)} 单${report.warning ? `｜提醒：${report.warning}` : ''}`;
  }
  return `[失败] ${report.storeName}｜${report.errorMessage || '未知错误'}（已继续下一家）`;
}

function 格式化回传店铺行(storeReport = {}) {
  return `[店铺] ${storeReport.storeName}｜${storeReport.status}｜成功 ${storeReport.success}/${storeReport.total}｜跳过 ${storeReport.skipped}｜失败 ${storeReport.error}${storeReport.errorMessage ? `｜${storeReport.errorMessage}` : ''}`;
}

function 构建限量店铺结果行(reports = [], formatter, limit = 结果页店铺上限) {
  const list = Array.isArray(reports) ? reports : [];
  const safeLimit = Math.max(1, Number.parseInt(limit, 10) || 结果页店铺上限);
  const lines = list.slice(0, safeLimit).map(formatter);
  if (list.length > safeLimit) {
    lines.push(`[省略] 另有 ${list.length - safeLimit} 家店铺明细（过程日志已直接显示在页面）。`);
  }
  return lines;
}

function 规范化平台进度(progress = {}) {
  const item = progress.item || progress.order || {};
  return {
    ...progress,
    ...item,
    key: String(item.key || progress.key || ''),
    orderNumber: String(item.orderNumber || progress.orderNumber || ''),
    status: String(progress.status || item.status || 'queued'),
    message: String(progress.message || item.message || ''),
  };
}

function 格式化批量汇总(platformName, report = {}) {
  const summary = report.summary || {};
  return `${platformName}回传汇总：店铺 ${summary.storeTotal || 0} 家（成功 ${summary.storeSuccess || 0}、部分成功 ${summary.storePartial || 0}、跳过 ${summary.storeSkipped || 0}、失败 ${summary.storeError || 0}），订单 ${summary.orderTotal || 0} 单（成功 ${summary.success || 0}、跳过 ${summary.skipped || 0}、失败 ${summary.error || 0}）。`;
}

function 创建平台回传CLI动作(options = {}) {
  const platformName = String(options.platformName || '').trim();
  const 回传要求已登记 = options.回传要求已登记 !== false;
  const getStores = options.获取启用店铺列表;
  const syncStore = options.同步单个店铺;
  const readOrders = options.读取订单列表;
  const readRegisteredOrders = options.读取店铺发票已登记订单;
  const updateWorkflow = options.更新订单工作流状态;
  const updateNote = options.设置订单备注;
  const executeFormalReturn = options.执行正式回传;
  const recordAttempt = options.设置订单回传尝试;
  const selectStores = options.选择店铺方法 || 选择店铺;
  if (!platformName || typeof getStores !== 'function' || typeof readOrders !== 'function') {
    throw new Error('创建平台回传 CLI 失败：缺少平台名、店铺读取或订单读取方法。');
  }

  async function 选择操作店铺(context, allowAll = true) {
    return selectStores({
      提问器: context.提问器,
      店铺列表: getStores(),
      允许全部: allowAll,
      输出: context.输出,
      终端: context.终端,
    });
  }

  function 读取状态统计文字() {
    return 构建四队列统计文字(readOrders());
  }

  async function 同步待处理订单(context, 指定店铺 = null) {
    if (typeof syncStore !== 'function') throw new Error(`${platformName}同步失败：缺少只读同步方法。`);
    const stores = Array.isArray(指定店铺) && 指定店铺.length ? 指定店铺 : await 选择操作店铺(context, true);
    const reports = [];
    for (const [index, store] of stores.entries()) {
      显示工作台页面(context, `${platformName} · 只读同步`, `正在处理第 ${index + 1}/${stores.length} 家店铺`, [
        `当前店铺：${store.name}`,
        '详细过程将直接显示在页面。',
      ]);
      记录工作台日志(context, `[同步] ${index + 1}/${stores.length}：${store.name}`);
      try {
        const result = await syncStore({ 店铺配置: store, headless: false });
        const report = { ...result, storeId: store.id, storeName: store.name, status: 'success' };
        reports.push(report);
        记录工作台日志(context, `[完成] ${result.message}`);
        if (result.warning) 记录工作台日志(context, `[提醒] ${result.warning}`);
        记录工作台日志(context, 格式化同步店铺行(report));
      } catch (error) {
        const errorMessage = String(error?.message || error || '未知错误');
        const report = { storeId: store.id, storeName: store.name, status: 'error', errorMessage };
        reports.push(report);
        记录工作台日志(context, 格式化同步店铺行(report));
      }
    }
    const successCount = reports.filter((item) => item.status === 'success').length;
    const orderCount = reports.reduce((sum, item) => sum + Number(item.orderCount || 0), 0);
    const summaryLine = `[汇总] ${platformName}只读同步完成：成功 ${successCount}/${stores.length} 家，读取 ${orderCount} 单，失败 ${stores.length - successCount} 家。`;
    显示工作台页面(context, `${platformName} · 同步结果`, '只读操作已结束，未下载、上传或提交发票。', [
      summaryLine,
      '',
      ...构建限量店铺结果行(reports, 格式化同步店铺行),
    ]);
    记录工作台日志(context, summaryLine);
    return reports;
  }

  async function 管理订单状态(context) {
    if (typeof updateWorkflow !== 'function') throw new Error(`${platformName}订单状态管理失败：缺少状态更新方法。`);
    return 打开订单状态管理({
      ...context,
      读取订单列表: readOrders,
      更新订单状态: updateWorkflow,
      更新订单备注: typeof updateNote === 'function' ? updateNote : null,
      格式化队列附加信息: (order) => {
        const attempt = order.lastReturnAttempt;
        const noteText = String(order.noteText || '').trim();
        const shortNote = noteText.length > 20 ? `${noteText.slice(0, 20)}…` : noteText;
        return [
          shortNote ? `备注：${shortNote}` : '',
          attempt?.status ? `本次回传：${attempt.status}` : '',
        ].filter(Boolean).join('｜');
      },
      格式化详情附加信息: (order) => {
        const attempt = order.lastReturnAttempt;
        return [
          `备注：${order.noteText || '-'}`,
          attempt?.status ? `本次回传：${attempt.status}${attempt.message ? `（${attempt.message}）` : ''}` : '',
        ].filter(Boolean).join('｜');
      },
    });
  }

  async function 正式回传(context, 指定店铺 = null) {
    if (typeof readRegisteredOrders !== 'function' || typeof executeFormalReturn !== 'function') {
      throw new Error(`${platformName}正式回传失败：缺少已登记订单读取或回传方法。`);
    }
    const stores = Array.isArray(指定店铺) && 指定店铺.length ? 指定店铺 : await 选择操作店铺(context, true);
    const registeredCount = stores.reduce((sum, store) => sum + readRegisteredOrders(store, { 要求已登记: 回传要求已登记 }).length, 0);
    const 回传范围说明 = 回传要求已登记
      ? '回传闸门只允许“发票已登记”且尚未成功的订单。'
      : '回传闸门只回传本地已同步、尚未成功的待回传订单。';
    显示工作台页面(context, `${platformName} · 正式回传`, `正在处理 ${stores.length} 家店铺、${registeredCount} 张发票`, [
      回传范围说明,
      `[待回传] 选中 ${stores.length} 家店铺，待回传订单 ${registeredCount} 单。`,
      '任务已启动，详细过程已移入本次运行日志。',
    ]);
    if (!registeredCount) {
      context.输出(回传要求已登记
        ? '[跳过] 没有发票已登记且待回传的订单，未启动浏览器。'
        : '[跳过] 没有已同步且待回传的订单，未启动浏览器。');
      return { stores: [], summary: { storeTotal: stores.length, orderTotal: 0, storeSkipped: stores.length } };
    }
    const latestProgress = new Map();
    const report = await 执行多店铺发票回传({
      stores,
      要求已登记: 回传要求已登记,
      读取店铺订单: (store) => readRegisteredOrders(store, { 要求已登记: 回传要求已登记 }),
      执行单店回传: async ({ store, orders, onProgress }) => executeFormalReturn({
        店铺配置: store,
        headless: false,
        要求已登记: 回传要求已登记,
        orders,
        onProgress: (progress) => onProgress(规范化平台进度(progress)),
      }),
      记录订单进度: typeof recordAttempt === 'function'
        ? ({ order, item }) => recordAttempt(order.key, {
          status: item.status,
          message: item.message,
          invoiceFilePath: item.invoiceFilePath,
          screenshotPath: item.screenshotPath,
        })
        : null,
      输出进度: ({ store, progress }) => {
        const normalized = 规范化平台进度(progress);
        const progressKey = normalized.key || normalized.orderNumber || `${store.id}:${latestProgress.size}`;
        latestProgress.set(progressKey, normalized);
        const completedCount = [...latestProgress.values()].filter((item) => 最终回传状态.has(item.status)).length;
        const progressLine = `[进度] ${store.name}｜${normalized.orderNumber || normalized.key || '-'}｜${normalized.message || normalized.status}`;
        记录工作台日志(context, progressLine);
        显示工作台页面(context, `${platformName} · 正式回传`, `已完成 ${completedCount}/${registeredCount} 单`, [
          `当前：${store.name}｜${normalized.orderNumber || normalized.key || '-'}｜${normalized.message || normalized.status}`,
          '详细过程将直接显示在页面。',
        ]);
      },
    });
    for (const storeReport of report.stores) {
      记录工作台日志(context, 格式化回传店铺行(storeReport));
      for (const item of storeReport.items || []) {
        记录工作台日志(context, [
          `[订单] ${storeReport.storeName}`,
          item.orderNumber || item.key || '-',
          item.status || '-',
          `抬头：${item.invoiceTitle || '-'}`,
          `类型：${item.invoiceType || '-'}`,
          `金额：${item.invoiceAmount || '-'}`,
          `申请：${item.invoiceApplyTime || '-'}`,
          `动作：${item.message || '-'}`,
          `文件：${item.invoiceFilePath || '-'}`,
          `截图：${item.screenshotPath || '-'}`,
          `更新：${item.updatedAt || '-'}`,
        ].join('｜'));
      }
    }
    const summaryLine = `[汇总] ${格式化批量汇总(platformName, report)}`;
    记录工作台日志(context, summaryLine);
    显示工作台页面(context, `${platformName} · 回传结果`, '逐单文件、截图和动作明细已随执行过程直接显示在页面。', [
      summaryLine,
      '',
      ...构建限量店铺结果行(report.stores, 格式化回传店铺行),
    ]);
    return report;
  }

  async function 一键发票回传(context) {
    // 解决：用户只想要“回传”这一个动作，同步（只读入库）与正式回传合并执行。
    const stores = await 选择操作店铺(context, true);
    await 同步待处理订单(context, stores);
    return 正式回传(context, stores);
  }

  return Object.freeze({
    读取状态统计文字,
    同步待处理订单,
    管理订单状态,
    正式回传,
    一键发票回传,
  });
}

module.exports = {
  显示工作台页面,
  格式化同步店铺行,
  格式化回传店铺行,
  构建限量店铺结果行,
  规范化平台进度,
  格式化批量汇总,
  创建平台回传CLI动作,
};
