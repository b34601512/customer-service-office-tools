const { 初始化运行目录, 读取JSON文件, 写入JSON文件 } = require('../common/fs');
const { 打印日志 } = require('../common/logger');
const {
  快照文件路径,
  获取店铺浏览器目录,
  获取店铺快照文件路径,
} = require('../common/paths');
const { 创建持久化浏览器上下文 } = require('../browser/createPersistentContext');
const { 注册浏览器上下文, 关闭店铺浏览器上下文 } = require('../browser/browserContextHub');
const { 打开目标页面 } = require('../browser/openTargetPage');
const { 确保已登录 } = require('../browser/ensureAuthenticatedPage');
const { 创建网络响应记录器 } = require('../invoice/networkRecorder');
const { 从页面提取记录 } = require('../invoice/extractFromPage');
const { 从接口提取记录 } = require('../invoice/extractFromResponses');
const { 等待开票治理业务数据就绪 } = require('../invoice/waitForInvoiceGovernanceReady');
const { 计算新增记录 } = require('../invoice/diffRecords');
const { 选择需要提醒的开票记录 } = require('../invoice/selectInvoiceAlertRecords');
const { 统计开票明细状态 } = require('../invoice/invoiceDetailStatus');
const { 保存巡检报告 } = require('../invoice/saveReport');
const { 发送桌面通知 } = require('../notify/sendDesktopNotification');
const { 构建默认店铺配置, 规范化店铺配置 } = require('../store/storeConfigService');
const {
  检查并处理运行目录膨胀,
  记录运行目录膨胀处理结果,
} = require('../runtime/browserProfile');
const { 应该关闭巡检浏览器 } = require('./browserRetentionPolicy');

function 获取最终页面保留模式(页面保留模式, 巡检后保持页面打开) {
  // 解决：把历史布尔开关和新保留模式统一成一个明确值。
  return String(页面保留模式 || '').trim() || (巡检后保持页面打开 ? 'wait' : 'close');
}

function 获取店铺快照路径(当前店铺) {
  // 解决：默认店铺沿用旧快照文件，多店铺按店铺维度隔离快照。
  return 当前店铺.id === 'default-store'
    ? 快照文件路径
    : 获取店铺快照文件路径(当前店铺.id);
}

function 读取上次快照(店铺快照路径) {
  // 解决：统一读取历史巡检快照，不存在时返回稳定空结构。
  return 读取JSON文件(店铺快照路径, {
    checkedAt: '',
    records: [],
  });
}

function 获取当前记录列表(页面结果, 响应记录器) {
  // 解决：页面能提取到记录时优先用页面结果，否则用接口响应记录补齐。
  const 接口记录 = 从接口提取记录(响应记录器.获取记录());
  return 页面结果.记录列表.length > 0 ? 页面结果.记录列表 : 接口记录;
}

function 等待毫秒(ms) {
  // 解决：接口优先路径只短等业务响应，不再默认等待整页 DOM 完整渲染。
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function 等待接口优先记录(响应记录器, 选项 = {}) {
  // 解决：业务接口已返回记录时直接使用接口数据，避免再扫描整页 DOM。
  const {
    timeoutMs = 8000,
    intervalMs = 200,
    当前时间方法 = () => Date.now(),
    等待方法 = 等待毫秒,
  } = 选项;
  const 截止时间 = 当前时间方法() + Math.max(0, Number(timeoutMs) || 0);

  while (true) {
    const 接口记录 = 从接口提取记录(响应记录器.获取记录());
    if (接口记录.length > 0) {
      return 接口记录;
    }

    if (当前时间方法() >= 截止时间) {
      return [];
    }

    await 等待方法(Math.max(1, Number(intervalMs) || 1));
  }
}

async function 读取轻量页面信息(page) {
  // 解决：接口优先成功时只读取标题和地址，不触发整页文本扫描。
  const 标题结果 = typeof page.title === 'function' ? page.title() : '';
  const 页面标题 = await Promise.resolve(标题结果).catch(() => '');
  const 页面地址 = typeof page.url === 'function' ? String(page.url() || '') : '';
  return {
    页面标题,
    页面地址,
  };
}

function 构建接口优先页面结果(页面信息, 接口记录) {
  // 解决：接口数据直接转成巡检结果结构，页面路径只作为兜底。
  const 状态统计 = 统计开票明细状态(接口记录, {
    明细总数: 接口记录.length,
  });
  return {
    页面标题: 页面信息.页面标题,
    页面地址: 页面信息.页面地址,
    页面预览: `接口优先提取到 ${接口记录.length} 条候选记录`,
    metrics: {
      页面警告订单数: 状态统计.页面警告订单数,
      警告订单数: 状态统计.有效警告订单数,
      及时上传发票订单数: 状态统计.及时上传发票订单数,
      应上传发票订单数: 状态统计.应上传发票订单数,
      上传指标已识别: 状态统计.上传指标已识别,
      待上传发票订单数: 状态统计.待上传发票订单数,
      明细总数: 状态统计.明细总数,
      待登记明细数: 状态统计.待登记明细数,
      已上传未逾期数: 状态统计.已上传未逾期数,
    },
    记录列表: 接口记录,
  };
}

function 构建巡检结果(参数) {
  // 解决：把磁盘快照、后台状态和通知所需字段统一成同一个结果对象。
  const {
    当前店铺,
    页面结果,
    当前记录,
    新增记录,
  } = 参数;
  return {
    storeId: 当前店铺.id,
    storeName: 当前店铺.name,
    storeEnabled: 当前店铺.enabled,
    checkedAt: new Date().toISOString(),
    pageTitle: 页面结果.页面标题,
    pageUrl: 页面结果.页面地址,
    pagePreview: 页面结果.页面预览,
    metrics: 页面结果.metrics ?? {
      警告订单数: 0,
      明细总数: 0,
      待登记明细数: 0,
      已上传未逾期数: 0,
    },
    records: 当前记录,
    newRecords: 新增记录,
  };
}

function 写入本次快照(店铺快照路径, 本次结果) {
  // 解决：只把下次去重需要的稳定字段写入快照，避免把临时报表信息混进去。
  写入JSON文件(店铺快照路径, {
    checkedAt: 本次结果.checkedAt,
    pageTitle: 本次结果.pageTitle,
    pageUrl: 本次结果.pageUrl,
    metrics: 本次结果.metrics,
    records: 本次结果.records,
  });
}

function 记录巡检结果日志(当前店铺, 本次结果) {
  // 解决：巡检完成后输出一行关键指标，方便从终端直接判断结果。
  打印日志(
    '巡检流程',
    '主流程',
    `店铺=${当前店铺.name} 共识别 ${本次结果.records.length} 条记录，新增 ${本次结果.newRecords.length} 条，待登记=${本次结果.metrics.待登记明细数 ?? 0}，已上传未逾期=${本次结果.metrics.已上传未逾期数 ?? 0}，有效告警=${本次结果.metrics.警告订单数}`,
  );
}

async function 发送提醒如果需要(本次结果, 需要提醒的记录) {
  // 解决：只有存在有效告警时才生成报告并发送桌面通知。
  if (需要提醒的记录.length === 0) {
    return;
  }

  const 报告路径 = 保存巡检报告({
    ...本次结果,
    newRecords: 需要提醒的记录,
  });
  const 消息正文 = 需要提醒的记录
    .slice(0, 3)
    .map((记录, 索引) => `${索引 + 1}. ${记录.summary}`)
    .join('\n');

  await 发送桌面通知(
    `京东开票巡检「${本次结果.storeName}」发现 ${需要提醒的记录.length} 条待登记记录`,
    `${消息正文}\n报告：${报告路径}`,
  );

  本次结果.reportPath = 报告路径;
}

async function 处理页面保留模式(page, context, 最终页面保留模式) {
  // 解决：把人工核对页的等待和保留行为集中处理，主流程只关心模式。
  if (最终页面保留模式 === 'wait') {
    await page.bringToFront();
    打印日志('人工核对', '主流程', '页面已保持打开，请你直接核对；看完关闭浏览器窗口即可结束');
    await new Promise((resolve) => {
      context.once('close', resolve);
    });
    return;
  }

  if (最终页面保留模式 === 'keep') {
    await page.bringToFront();
    打印日志('人工核对', '主流程', '页面已保持打开，当前店铺排查结果已写回后台，任务将继续执行下一家店铺');
  }
}

async function 创建并注册浏览器上下文(当前店铺, headless) {
  // 解决：把创建、注册和路径选择收口，避免主流程混入浏览器资料目录细节。
  const context = await 创建持久化浏览器上下文({
    headless,
    店铺标识: 当前店铺.id,
    浏览器目录路径: 获取店铺浏览器目录(当前店铺.id),
  });
  注册浏览器上下文(context, {
    店铺名称: 当前店铺.name,
    店铺标识: 当前店铺.id,
  });
  return context;
}

async function 执行巡检(选项 = {}) {
  // 解决：串起浏览器、登录、提取、去重、提醒和页面保留，形成完整巡检闭环。
  const {
    headless = true,
    允许人工登录 = false,
    自动提交登录 = false,
    强制人工登录 = false,
    登录失效自动转人工 = false,
    巡检后保持页面打开 = false,
    页面保留模式 = '',
    店铺配置 = null,
    启用运行目录膨胀守卫 = false,
    接口优先等待Ms = 8000,
  } = 选项;

  初始化运行目录();
  if (启用运行目录膨胀守卫) {
    记录运行目录膨胀处理结果(检查并处理运行目录膨胀(), '巡检流程');
  }
  打印日志('巡检流程', '主流程', '开始执行开票巡检');

  const 当前店铺 = 规范化店铺配置(店铺配置 || 构建默认店铺配置());
  const 最终页面保留模式 = 获取最终页面保留模式(页面保留模式, 巡检后保持页面打开);
  const 店铺快照路径 = 获取店铺快照路径(当前店铺);
  const 上次快照 = 读取上次快照(店铺快照路径);

  await 关闭店铺浏览器上下文(当前店铺.id);

  let context = null;
  let page = null;
  let 响应记录器 = null;
  let 浏览器已关闭 = false;
  let 巡检成功 = false;

  try {
    context = await 创建并注册浏览器上下文(当前店铺, headless);
    context.once('close', () => {
      浏览器已关闭 = true;
    });

    page = await 打开目标页面(context, 当前店铺.targetUrl);
    响应记录器 = 创建网络响应记录器(page);

    await 确保已登录(page, {
      允许人工登录,
      自动提交登录,
      强制人工登录,
      店铺配置: 当前店铺,
      目标地址: 当前店铺.targetUrl,
    });
    打印日志('巡检流程', '主流程', '登录与目标页确认完成，开始提取开票治理数据');
    const 接口优先记录 = await 等待接口优先记录(响应记录器, {
      timeoutMs: 接口优先等待Ms,
    });
    const 页面结果 = 接口优先记录.length > 0
      ? 构建接口优先页面结果(await 读取轻量页面信息(page), 接口优先记录)
      : await (async () => {
        await 等待开票治理业务数据就绪(page, {
          timeoutMs: 180_000,
        });
        return 从页面提取记录(page);
      })();
    const 当前记录 = 获取当前记录列表(页面结果, 响应记录器);
    const 新增记录 = 计算新增记录(上次快照.records, 当前记录);
    const 需要提醒的记录 = 选择需要提醒的开票记录({
      当前记录,
      新增记录,
      上次指标: 上次快照.metrics,
      本次指标: 页面结果.metrics,
    });
    const 本次结果 = 构建巡检结果({
      当前店铺,
      页面结果,
      当前记录,
      新增记录,
    });

    写入本次快照(店铺快照路径, 本次结果);
    记录巡检结果日志(当前店铺, 本次结果);
    await 发送提醒如果需要(本次结果, 需要提醒的记录);
    await 处理页面保留模式(page, context, 最终页面保留模式);

    巡检成功 = true;
    return 本次结果;
  } catch (错误) {
    if (登录失效自动转人工 && !强制人工登录 && String(错误.message || '').includes('登录态失效')) {
      打印日志('巡检流程', '登录恢复', `店铺=${当前店铺.name} 登录态失效，自动弹出可见窗口进入人工登录流程`);
      await 发送桌面通知(
        `京东开票巡检「${当前店铺.name}」登录态失效`,
        '已自动弹出登录窗口，请在浏览器里完成验证，完成后自动继续巡检。',
      ).catch(() => {});
      return 执行巡检({
        ...选项,
        店铺配置: 当前店铺,
        headless: false,
        允许人工登录: true,
        强制人工登录: true,
      });
    }
    throw 错误;
  } finally {
    if (响应记录器) {
      响应记录器.停止();
    }
    if (context && !浏览器已关闭 && 应该关闭巡检浏览器(最终页面保留模式, 巡检成功)) {
      await context.close();
    }
  }
}

module.exports = {
  执行巡检,
  获取最终页面保留模式,
  等待接口优先记录,
  构建接口优先页面结果,
};
