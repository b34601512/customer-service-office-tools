const { 初始化运行目录 } = require('../common/fs');
const { 打印日志 } = require('../common/logger');
const { 规范化店铺配置 } = require('../store/storeConfigService');
const { 从下载中心下载发票, 批量从下载中心下载发票 } = require('../invoiceReturn/downloadCenterInvoiceDownloader');
const { 回传发票到京东, 执行京东回传会话 } = require('../invoiceReturn/jdInvoiceUploader');
const { 是需要可见浏览器处理的回传错误 } = require('../invoiceReturn/visibleFallbackPolicy');
const {
  设置订单发票回传成功,
  设置订单回传尝试,
  是平台待开票待回传订单,
} = require('../order/jdOrderRecordStore');

function 读取默认回传尝试保存方法() {
  // 解决：自动测试只用注入桩验证流程，生产运行才允许写默认订单文件。
  return process.env.NODE_TEST_CONTEXT ? () => {} : 设置订单回传尝试;
}

function 校验回传输入({ order, store }) {
  // 解决：外部上传前只校验京东回传必须信息，发票下载交给公共下载中心负责。
  const orderNumber = String(order?.orderNumber || '').trim();
  if (!order?.key || !orderNumber) {
    throw new Error('发票回传失败：订单记录缺少订单号。');
  }
  if (order.invoiceReturned) {
    throw new Error(`订单 ${orderNumber} 已经回传过发票，请勿重复上传。`);
  }
  if (!是平台待开票待回传订单(order)) {
    throw new Error(`发票回传失败：订单 ${orderNumber} 在京东后台必须处于“待开票”状态。`);
  }
  if (!store?.id) {
    throw new Error(`发票回传失败：订单 ${orderNumber} 没有绑定京东店铺。`);
  }
  return {
    orderNumber,
    店铺配置: 规范化店铺配置(store),
  };
}

function 是待批量回传订单(order) {
  // 解决：批量入口只处理京东后台“待开票”但还没回传、也还没归档完成的订单。
  return 是平台待开票待回传订单(order);
}

function 构建持久化进度回调(onProgress, 设置订单回传尝试方法) {
  // 解决：下载、跳过、上传和失败事实走同一出口落盘，不能冒充人工处理阶段。
  return (progress = {}) => {
    const item = progress.item || {};
    const status = String(progress.status || '').trim();
    if (progress.type === 'item' && item.key && ['queued', 'downloading', 'downloaded', 'uploading', 'success', 'skipped', 'error'].includes(status)) {
      设置订单回传尝试方法(item.key, {
        status,
        message: String(progress.message || ''),
        invoiceFilePath: String(item.invoiceFilePath || ''),
        screenshotPath: String(item.screenshotPath || ''),
      });
    }
    if (typeof onProgress === 'function') onProgress(progress);
  };
}

function 构建店铺映射(stores) {
  // 解决：批量回传按订单所属店铺找京东账号，找不到就直接暴露配置问题。
  return new Map((Array.isArray(stores) ? stores : []).map((store) => [String(store.id || '').trim(), 规范化店铺配置(store)]));
}

function 规范化批量回传订单({ orders, stores }) {
  // 解决：批量任务先确定本轮真实工作集，下载中心只接收明确订单清单。
  const 店铺映射 = 构建店铺映射(stores);
  const 待回传订单 = (Array.isArray(orders) ? orders : []).filter(是待批量回传订单).map((order) => {
    const key = String(order.key || '').trim();
    const orderNumber = String(order.orderNumber || '').trim();
    if (!key || !orderNumber) {
      throw new Error('批量发票回传失败：待开票订单缺少 key 或订单号。');
    }
    const 店铺配置 = 店铺映射.get(String(order.storeId || '').trim());
    if (!店铺配置) {
      throw new Error(`批量发票回传失败：没有找到订单 ${order.orderNumber} 所属店铺 ${order.storeId}。`);
    }
    return {
      key,
      orderNumber,
      storeId: String(order.storeId || '').trim(),
      店铺配置,
    };
  });
  if (!待回传订单.length) {
    throw new Error('批量发票回传失败：当前没有京东后台“待开票且未回传”的订单。');
  }
  return {
    待回传订单,
  };
}

function 是发票未找到错误(错误) {
  // 解决：公共下载中心确认发票未开好时，本项目只跳过当前订单继续整批任务。
  const code = String(错误?.code || 错误?.response?.code || '').trim();
  const message = String(错误?.message || '').trim();
  return code === 'INVOICE_NOT_FOUND_IN_NUONUO' || message.includes('诺诺发票系统没有找到可下载发票');
}

function 构建订单映射(待回传订单) {
  // 解决：下载中心返回文件后，按 key 或订单号找回本项目自己的订单身份。
  const 订单映射 = new Map();
  for (const order of 待回传订单) {
    订单映射.set(order.key, order);
    订单映射.set(order.orderNumber, order);
  }
  return 订单映射;
}

function 按店铺构建回传会话清单(待回传订单, 下载结果) {
  // 解决：京东会话由本轮待回传店铺决定；即使没有下载到发票，也必须打开页面供人工核对。
  const 订单映射 = 构建订单映射(待回传订单);
  const 分组 = new Map();
  for (const order of 待回传订单) {
    if (!分组.has(order.storeId)) {
      分组.set(order.storeId, {
        店铺配置: order.店铺配置,
        invoiceUploads: [],
      });
    }
  }
  for (const download of 下载结果) {
    const order = 订单映射.get(download.key) || 订单映射.get(download.orderNumber);
    if (!order) {
      throw new Error(`批量发票回传失败：下载结果 ${download?.orderNumber || download?.key || ''} 找不到原始订单。`);
    }
    if (!download?.invoiceFilePath) {
      throw new Error(`批量发票回传失败：订单 ${order.orderNumber} 缺少已下载发票文件。`);
    }
    分组.get(order.storeId).invoiceUploads.push({
      key: order.key,
      orderNumber: order.orderNumber,
      invoiceFilePath: download.invoiceFilePath,
    });
  }
  return Array.from(分组.values());
}

function 通知回传进度(onProgress, progress) {
  // 解决：批量回传逐单状态只通过一个回调出口上报，避免下载和上传阶段各写各的。
  if (typeof onProgress === 'function') {
    onProgress({
      ...progress,
      updatedAt: new Date().toISOString(),
    });
  }
}

function 构建回传报告订单(order) {
  // 解决：前端报告只需要订单身份和店铺身份，不暴露京东登录配置。
  return {
    key: order.key,
    storeId: order.storeId,
    storeName: order.店铺配置.name,
    orderNumber: order.orderNumber,
  };
}

function 获取上传条目标识(item) {
  // 解决：上传统计统一按 key 优先、订单号兜底识别同一张发票。
  return String(item?.key || item?.orderNumber || '').trim();
}

function 创建上传统计() {
  // 解决：批量上传的成功和失败集合集中管理，避免主流程里散落计数变量。
  return {
    successCount: 0,
    已完成上传标识集合: new Set(),
    已失败上传标识集合: new Set(),
  };
}

function 补充店铺身份(item, 店铺配置) {
  // 解决：上传器只关心京东动作，报告层在上层补齐店铺展示字段。
  return {
    ...item,
    storeId: 店铺配置.id,
    storeName: 店铺配置.name,
  };
}

function 获取未完成上传清单(group, 上传统计) {
  // 解决：可见重试只处理还没成功也没明确失败的订单，避免重复上传已完成订单。
  return group.invoiceUploads.filter((item) => {
    const 标识 = 获取上传条目标识(item);
    return !上传统计.已完成上传标识集合.has(标识) && !上传统计.已失败上传标识集合.has(标识);
  });
}

function 记录上传成功({ item, group, 上传统计, 设置订单发票回传成功方法, onProgress }) {
  // 解决：单张发票上传成功后的落盘、计数和报告只走一个出口。
  const 完成消息 = item.alreadyInvoiced
    ? `订单 ${item.orderNumber} 已在京东后台显示开票成功，已标记为已回传。`
    : `订单 ${item.orderNumber} 发票已批量回传到京东后台。`;
  设置订单发票回传成功方法(item.key, {
    invoiceFilePath: item.invoiceFilePath,
    screenshotPath: item.screenshotPath,
    message: 完成消息,
  });
  const 标识 = 获取上传条目标识(item);
  if (!上传统计.已完成上传标识集合.has(标识)) {
    上传统计.已完成上传标识集合.add(标识);
    上传统计.successCount += 1;
  }
  通知回传进度(onProgress, {
    type: 'item',
    status: 'success',
    message: 完成消息,
    item: 补充店铺身份(item, group.店铺配置),
  });
}

function 记录上传失败({ item, 错误, group, 上传统计, onProgress }) {
  // 解决：单张发票上传失败只标记当前订单，不影响同组后续订单继续回传。
  上传统计.已失败上传标识集合.add(获取上传条目标识(item));
  通知回传进度(onProgress, {
    type: 'item',
    status: 'error',
    message: `上传失败：${错误.message}`,
    item: 补充店铺身份(item, group.店铺配置),
  });
}

function 构建京东上传回调({ group, 上传统计, 设置订单发票回传成功方法, onProgress }) {
  // 解决：上传器回调统一在上层转换成业务报告，避免上传器直接碰订单存储。
  return {
    onUploadStart: (item) => {
      通知回传进度(onProgress, {
        type: 'item',
        status: 'uploading',
        message: `正在上传到京东后台：${group.店铺配置.name}`,
        item: 补充店铺身份(item, group.店铺配置),
      });
    },
    onUploadProgress: (item, progress = {}) => {
      通知回传进度(onProgress, {
        type: 'item',
        status: 'uploading',
        message: progress.message || `正在上传到京东后台：${group.店铺配置.name}`,
        item: {
          ...补充店铺身份(item, group.店铺配置),
          uploadStage: progress.stage || '',
        },
      });
    },
    onUploaded: (item) => 记录上传成功({
      item,
      group,
      上传统计,
      设置订单发票回传成功方法,
      onProgress,
    }),
    onUploadFailed: (item, 错误) => 记录上传失败({
      item,
      错误,
      group,
      上传统计,
      onProgress,
    }),
  };
}

async function 执行京东上传分组(选项) {
  // 解决：同一店铺的一批发票只通过一个上传调用入口执行。
  const {
    group,
    headless,
    允许人工登录,
    执行京东回传会话方法,
    上传统计,
    设置订单发票回传成功方法,
    onProgress,
    需要可见浏览器处理方法 = null,
    凭证批次目录 = '',
    页面保留模式 = 'close',
  } = 选项;
  const 上传回调 = 构建京东上传回调({
    group,
    上传统计,
    设置订单发票回传成功方法,
    onProgress,
  });
  await 执行京东回传会话方法({
    店铺配置: group.店铺配置,
    invoiceUploads: group.invoiceUploads,
    headless,
    允许人工登录,
    continueOnItemError: true,
    需要可见浏览器处理方法,
    凭证批次目录,
    页面保留模式,
    ...上传回调,
  });
}

function 通知切换可见浏览器({ group, 上传统计, onProgress, 错误 }) {
  // 解决：后台模式遇到必须人工处理的登录或验证时，逐单报告切到等待人工状态。
  const 未完成清单 = 获取未完成上传清单(group, 上传统计);
  for (const item of 未完成清单) {
    通知回传进度(onProgress, {
      type: 'item',
      status: 'uploading',
      message: `检测到需要人工处理，正在打开可见浏览器：${错误.message}`,
      item: 补充店铺身份(item, group.店铺配置),
    });
  }
}

async function 执行带可见回退的京东上传分组(选项) {
  // 解决：批量回传默认后台执行，只在登录或验证码必须人工处理时打开当前店铺窗口。
  const {
    group,
    headless,
    上传统计,
    onProgress,
  } = 选项;
  try {
    await 执行京东上传分组({
      ...选项,
      允许人工登录: !headless,
      需要可见浏览器处理方法: headless ? 是需要可见浏览器处理的回传错误 : null,
    });
  } catch (错误) {
    if (!headless || !是需要可见浏览器处理的回传错误(错误)) {
      throw 错误;
    }
    const 未完成清单 = 获取未完成上传清单(group, 上传统计);
    if (未完成清单.length === 0) {
      return;
    }
    打印日志('发票回传', '批量流程', `后台回传需要人工处理，切换为可见浏览器：${group.店铺配置.name}；原因=${错误.message}`);
    通知切换可见浏览器({ group, 上传统计, onProgress, 错误 });
    await 执行京东上传分组({
      ...选项,
      group: {
        ...group,
        invoiceUploads: 未完成清单,
      },
      headless: false,
      允许人工登录: true,
      需要可见浏览器处理方法: null,
    });
  }
}

async function 逐单下载发票(待回传订单, 选项 = {}) {
  // 解决：下载中心默认后台逐单处理，只有上层明确要求时才打开可见窗口。
  const {
    批量下载发票方法,
    headless = true,
    onProgress = null,
  } = 选项;
  const 下载结果 = [];
  for (const [索引, order] of 待回传订单.entries()) {
    通知回传进度(onProgress, {
      type: 'item',
      status: 'downloading',
      message: `正在下载第 ${索引 + 1}/${待回传订单.length} 张发票。`,
      item: 构建回传报告订单(order),
    });
    try {
      const downloadList = await 批量下载发票方法({
        orders: [order],
        headless,
      });
      const download = Array.isArray(downloadList) ? downloadList[0] : null;
      if (!download?.invoiceFilePath) {
        throw new Error(`下载中心没有返回订单 ${order.orderNumber} 的发票文件。`);
      }
      const 下载条目 = {
        ...download,
        key: download.key || order.key,
        orderNumber: download.orderNumber || order.orderNumber,
      };
      下载结果.push(下载条目);
      通知回传进度(onProgress, {
        type: 'item',
        status: 'downloaded',
        message: `发票文件已下载：${下载条目.invoiceFilePath}`,
        item: {
          ...构建回传报告订单(order),
          invoiceFilePath: 下载条目.invoiceFilePath,
        },
      });
    } catch (错误) {
      if (是发票未找到错误(错误)) {
        通知回传进度(onProgress, {
          type: 'item',
          status: 'skipped',
          message: `已跳过：下载中心没有找到可下载发票，可能尚未开票。${错误.message}`,
          item: 构建回传报告订单(order),
        });
        continue;
      }
      通知回传进度(onProgress, {
        type: 'item',
        status: 'error',
        message: `下载失败：${错误.message}`,
        item: 构建回传报告订单(order),
      });
      throw 错误;
    }
  }
  return 下载结果;
}

async function 执行发票回传(选项 = {}) {
  // 解决：把公共下载中心和京东上传串成一个可测试的上层业务流程。
  const {
    order,
    store,
    headless = true,
    下载发票方法 = 从下载中心下载发票,
    回传发票到京东方法 = 回传发票到京东,
    设置订单发票回传成功方法 = 设置订单发票回传成功,
    设置订单回传尝试方法 = 读取默认回传尝试保存方法(),
    凭证批次目录 = '',
  } = 选项;
  初始化运行目录();
  const { orderNumber, 店铺配置 } = 校验回传输入({ order, store });

  打印日志('发票回传', '主流程', `开始回传订单：${店铺配置.name} ${orderNumber}`);
  设置订单回传尝试方法(order.key, { status: 'downloading', message: '正在从下载中心获取发票。' });
  let invoiceFilePath = '';
  try {
    invoiceFilePath = await 下载发票方法({
      order: {
        key: order.key,
        storeId: 店铺配置.id,
        storeName: 店铺配置.name,
        orderNumber,
      },
      orderNumber,
      headless,
    });
    设置订单回传尝试方法(order.key, { status: 'uploading', message: '正在上传京东后台。', invoiceFilePath });
    await 回传发票到京东方法({
      店铺配置,
      orderNumber,
      invoiceFilePath,
      headless,
      凭证批次目录,
    });
  } catch (error) {
    设置订单回传尝试方法(order.key, {
      status: 是发票未找到错误(error) ? 'skipped' : 'error',
      message: String(error?.message || error),
      invoiceFilePath,
    });
    throw error;
  }

  const message = `订单 ${orderNumber} 发票已回传到京东后台。`;
  const updatedOrder = 设置订单发票回传成功方法(order.key, {
    invoiceFilePath,
    message,
  });
  打印日志('发票回传', '主流程', message);
  return {
    order: updatedOrder,
    orderNumber,
    invoiceFilePath,
    message,
  };
}

async function 执行批量发票回传(选项 = {}) {
  // 解决：京东后台“待开票”订单先从下载中心拿到文件清单，再按京东店铺批量回传。
  const {
    orders,
    stores,
    headless = true,
    批量下载发票方法 = 批量从下载中心下载发票,
    执行京东回传会话方法 = 执行京东回传会话,
    设置订单发票回传成功方法 = 设置订单发票回传成功,
    设置订单回传尝试方法 = 读取默认回传尝试保存方法(),
    onProgress = null,
    凭证批次目录 = '',
    页面保留模式 = 'close',
  } = 选项;
  初始化运行目录();
  const { 待回传订单 } = 规范化批量回传订单({ orders, stores });
  const 持久化进度回调 = 构建持久化进度回调(onProgress, 设置订单回传尝试方法);
  通知回传进度(持久化进度回调, {
    type: 'init',
    status: 'running',
    message: `准备回传 ${待回传订单.length} 张待开票发票。`,
    items: 待回传订单.map(构建回传报告订单),
  });
  打印日志('发票回传', '批量流程', `开始通过下载中心获取发票：${待回传订单.length} 单`);
  const 下载结果 = await 逐单下载发票(待回传订单, {
    批量下载发票方法,
    headless,
    onProgress: 持久化进度回调,
  });
  const skippedCount = 待回传订单.length - 下载结果.length;
  const 店铺回传会话清单 = 按店铺构建回传会话清单(待回传订单, 下载结果);
  const 上传统计 = 创建上传统计();
  for (const group of 店铺回传会话清单) {
    const 会话说明 = group.invoiceUploads.length > 0
      ? `待上传 ${group.invoiceUploads.length} 单`
      : '没有可上传发票，仅打开页面供核对';
    打印日志('发票回传', '批量流程', `打开京东店铺「${group.店铺配置.name}」：${会话说明}`);
    try {
      await 执行带可见回退的京东上传分组({
        group,
        headless,
        执行京东回传会话方法,
        上传统计,
        设置订单发票回传成功方法,
        onProgress: 持久化进度回调,
        凭证批次目录,
        页面保留模式,
      });
    } catch (错误) {
      const 未完成订单 = 获取未完成上传清单(group, 上传统计)[0];
      if (未完成订单) {
        通知回传进度(持久化进度回调, {
          type: 'item',
          status: 'error',
          message: `上传中断：${错误.message}`,
          item: {
            ...未完成订单,
            storeId: group.店铺配置.id,
            storeName: group.店铺配置.name,
          },
        });
      }
      throw 错误;
    }
  }
  const failedCount = 上传统计.已失败上传标识集合.size;
  const 补充统计 = [
    failedCount ? `失败 ${failedCount} 单` : '',
    skippedCount ? `跳过 ${skippedCount} 单` : '',
  ].filter(Boolean).join('，');
  const message = 补充统计
    ? `批量发票回传完成：成功 ${上传统计.successCount}/${待回传订单.length} 单，${补充统计}。`
    : `批量发票回传完成：成功 ${上传统计.successCount}/${待回传订单.length} 单。`;
  打印日志('发票回传', '批量流程', message);
  通知回传进度(持久化进度回调, {
    type: 'finish',
    status: 'success',
    message,
  });
  return {
    message,
    successCount: 上传统计.successCount,
    failedCount,
    skippedCount,
    totalCount: 待回传订单.length,
  };
}

module.exports = {
  校验回传输入,
  是待批量回传订单,
  构建持久化进度回调,
  是发票未找到错误,
  规范化批量回传订单,
  执行发票回传,
  执行批量发票回传,
};
