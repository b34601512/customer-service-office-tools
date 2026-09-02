const { 打印日志 } = require('../common/logger');
const { 构建申请时间接口字段 } = require('./dateRange');
const { 默认接口每页条数, 规范化接口每页条数 } = require('./invoiceApiPageSize');

const 接口每页条数 = 默认接口每页条数;
const 最大接口页数 = 500;
const 默认接口分页并发数 = 3;
const 最大接口分页并发数 = 10;

function 解析JSON文本(文本, 上下文) {
  // 解决：京东接口响应不是 JSON 时直接暴露原始问题，禁止按空列表继续跑。
  try {
    return JSON.parse(文本);
  } catch {
    throw new Error(`${上下文}失败：京东接口返回内容不是 JSON。`);
  }
}

function 读取接口订单列表(json, 上下文) {
  // 解决：消费者发票接口订单数组只允许来自 data.data，结构变了就必须失败。
  const 列表 = json?.data?.data;
  if (!Array.isArray(列表)) {
    throw new Error(`${上下文}失败：京东接口响应缺少 data.data 订单列表。`);
  }
  return 列表;
}

function 读取接口总条数(json, 当前页条数) {
  // 解决：总数优先相信接口 totalCount，缺失时只退到当前页数量。
  const totalCount = Number(json?.data?.totalCount);
  return Number.isFinite(totalCount) && totalCount >= 0 ? totalCount : 当前页条数;
}

function 解析接口响应(响应文本, 上下文) {
  // 解决：每一页接口响应都按同一套规则校验，异常禁止静默降级。
  const json = 解析JSON文本(响应文本, 上下文);
  if (json?.code !== 200) {
    throw new Error(`${上下文}失败：京东接口返回 code=${json?.code ?? '未知'}，原因=${json?.msg || json?.message || '未知'}`);
  }
  const rows = 读取接口订单列表(json, 上下文);
  return {
    rows,
    totalCount: 读取接口总条数(json, rows.length),
    pageSize: Number(json?.data?.pageSize) || rows.length,
  };
}

function 复制可复用请求头(headers = {}) {
  // 解决：保留 h5st 等页面签名头，排除浏览器禁止手动设置的头。
  return Object.entries(headers).reduce((结果, [名称, 值]) => {
    if (/^(cookie|host|origin|referer|user-agent|content-length|accept-encoding)$/i.test(名称)) {
      return 结果;
    }
    结果[名称] = 值;
    return 结果;
  }, {});
}

function 规范化接口分页并发数(value) {
  // 解决：剩余页不能一次性全部并发打京东接口，避免页数多时触发平台限流。
  const numberValue = Number.parseInt(value, 10);
  if (!Number.isFinite(numberValue)) {
    return 默认接口分页并发数;
  }
  if (numberValue < 1 || numberValue > 最大接口分页并发数) {
    throw new Error(`接口分页并发数必须在 1 到 ${最大接口分页并发数} 之间。`);
  }
  return numberValue;
}

function 构建文本进度条(percent, width = 20) {
  // 解决：终端日志用纯文本进度条表达当前读取位置，避免用户误以为程序卡死。
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const filledCount = Math.max(0, Math.min(width, Math.round((safePercent / 100) * width)));
  return `[${'#'.repeat(filledCount)}${'-'.repeat(width - filledCount)}]`;
}

function 构建接口分页进度({ 已完成页数, 总页数, totalCount, pageSize, concurrentPageCount }) {
  // 解决：分页进度结构只在一个地方计算，日志和后台页面展示保持一致。
  const totalPageCount = Math.max(1, Number.parseInt(总页数, 10) || 1);
  const finishedPageCount = Math.max(0, Math.min(totalPageCount, Number.parseInt(已完成页数, 10) || 0));
  const percent = Math.min(100, Math.floor((finishedPageCount / totalPageCount) * 100));
  const progressBar = 构建文本进度条(percent);
  return {
    type: 'invoice-pages',
    finishedPageCount,
    totalPageCount,
    percent,
    progressBar,
    totalCount: Number(totalCount || 0),
    pageSize,
    concurrentPageCount,
    message: `${progressBar} ${finishedPageCount}/${totalPageCount}页 ${percent}%`,
  };
}

function 通知接口分页进度(onProgress, 进度) {
  // 解决：分页读取器只通知进度，不直接依赖上层运行状态对象。
  if (typeof onProgress === 'function') {
    onProgress(进度);
  }
}

function 读取基础请求体(postData) {
  // 解决：后续分页只改 request 内的业务字段，避免丢掉 accessContext。
  const payload = 解析JSON文本(postData, '读取京东接口请求体');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('读取京东接口请求体失败：请求体根节点必须是对象。');
  }
  if (!payload.request || typeof payload.request !== 'object' || Array.isArray(payload.request)) {
    throw new Error('读取京东接口请求体失败：request 必须是对象。');
  }
  return payload;
}

function 构建分页请求体(基础请求体, 页码, 日期范围, pageSize = 默认接口每页条数) {
  // 解决：分页请求只集中修改页码、页大小和申请时间，避免调用方拼错字段。
  const 接口页大小 = 规范化接口每页条数(pageSize);
  const payload = JSON.parse(JSON.stringify(基础请求体));
  payload.request.pageIndex = 页码;
  payload.request.pageSize = 接口页大小;
  payload.request.orderId = null;
  Object.assign(payload.request, 构建申请时间接口字段(日期范围));
  return payload;
}

async function 请求接口页(page, 请求模板, 请求体, 页码) {
  // 解决：在京东页面上下文里发请求，复用当前登录态和浏览器安全环境。
  const 响应文本 = await page.evaluate(async ({ url, headers, body }) => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body,
    });
    return response.text();
  }, {
    url: 请求模板.url,
    headers: 请求模板.headers,
    body: JSON.stringify(请求体),
  }).catch((错误) => {
    throw new Error(`读取京东催促开票接口第 ${页码} 页失败：${错误.message}`);
  });
  return 解析接口响应(响应文本, `读取京东催促开票接口第 ${页码} 页`);
}

function 计算需要读取页数(totalCount, pageSize = 默认接口每页条数) {
  // 解决：按店铺配置页大小计算读取次数，避免继续依赖京东页面分页控件。
  if (totalCount <= 0) return 0;
  const 接口页大小 = 规范化接口每页条数(pageSize);
  const 页数 = Math.ceil(totalCount / 接口页大小);
  if (页数 > 最大接口页数) {
    throw new Error(`读取京东催促开票接口失败：页数 ${页数} 超过安全上限 ${最大接口页数}。`);
  }
  return 页数;
}

function 合并接口页结果(页结果列表, 日期范围, pageSize = 默认接口每页条数) {
  // 解决：接口分页结果统一合并并生成扫描指标。
  const 接口页大小 = 规范化接口每页条数(pageSize);
  const rows = 页结果列表.flatMap((页结果) => 页结果.rows);
  const totalCount = 页结果列表[0]?.totalCount || 0;
  return {
    rows,
    metrics: {
      scannedPageCount: 页结果列表.length,
      totalItems: totalCount,
      maxPage: 页结果列表.length,
      pageSize: 接口页大小,
      concurrentPageCount: 默认接口分页并发数,
      applicationDateRange: 日期范围,
      pageDetails: 页结果列表.map((页结果, 索引) => ({
        pageNumber: 索引 + 1,
        invoiceOrderCount: 页结果.rows.length,
      })),
    },
  };
}

async function 分批读取接口页列表(页码列表, 每批页数, 读取单页, 选项 = {}) {
  // 解决：把大量剩余页拆成小批次读取，避免 Promise.all 一次性发出几十个请求。
  const 页结果列表 = [];
  for (let index = 0; index < 页码列表.length; index += 每批页数) {
    const 当前批次页码列表 = 页码列表.slice(index, index + 每批页数);
    const 当前批次结果 = await Promise.all(当前批次页码列表.map((页码) => 读取单页(页码)));
    页结果列表.push(...当前批次结果);
    if (typeof 选项.onBatchComplete === 'function') {
      选项.onBatchComplete({
        batchPageNumbers: 当前批次页码列表,
        finishedCount: 页结果列表.length,
      });
    }
  }
  return 页结果列表;
}

async function 读取全部发票申请单(page, 捕获请求, 日期范围, 选项 = {}) {
  // 解决：先读取带申请时间的第一页，再按真实总数小批量读取剩余页。
  const 接口页大小 = 规范化接口每页条数(选项.pageSize ?? 默认接口每页条数);
  const 分页并发数 = 规范化接口分页并发数(选项.concurrentPageCount ?? 默认接口分页并发数);
  const onProgress = 选项.onProgress;
  解析接口响应(捕获请求.responseText, '读取京东催促开票接口首屏');
  const 请求模板 = {
    url: 捕获请求.url,
    headers: 复制可复用请求头(捕获请求.headers),
  };
  const 基础请求体 = 读取基础请求体(捕获请求.postData);
  const 第一页结果 = await 请求接口页(page, 请求模板, 构建分页请求体(基础请求体, 1, 日期范围, 接口页大小), 1);
  const 总页数 = 计算需要读取页数(第一页结果.totalCount, 接口页大小);
  const 剩余页码列表 = Array.from({ length: Math.max(0, 总页数 - 1) }, (_, index) => index + 2);
  const 进度总页数 = Math.max(1, 总页数);

  const 推送分页进度 = (已完成页数) => {
    const 进度 = 构建接口分页进度({
      已完成页数,
      总页数: 进度总页数,
      totalCount: 第一页结果.totalCount,
      pageSize: 接口页大小,
      concurrentPageCount: 分页并发数,
    });
    打印日志('数据提取', '接口分页', `读取进度：${进度.message}`, { 原地刷新: true });
    通知接口分页进度(onProgress, 进度);
  };

  打印日志('数据提取', '接口分页', `开始读取京东接口：总数=${第一页结果.totalCount}，每页=${接口页大小}，页数=${总页数}，并发=${分页并发数}`);
  推送分页进度(1);
  const 剩余页结果列表 = await 分批读取接口页列表(剩余页码列表, 分页并发数, (页码) => (
    请求接口页(page, 请求模板, 构建分页请求体(基础请求体, 页码, 日期范围, 接口页大小), 页码)
  ), {
    onBatchComplete: ({ finishedCount }) => 推送分页进度(1 + finishedCount),
  });
  const 页结果列表 = 总页数 === 0 ? [第一页结果] : [第一页结果, ...剩余页结果列表];
  const 合并结果 = 合并接口页结果(页结果列表, 日期范围, 接口页大小);
  合并结果.metrics.concurrentPageCount = 分页并发数;
  打印日志('数据提取', '接口分页', `接口读取完成：发票订单=${合并结果.rows.length}`);
  return 合并结果;
}

module.exports = {
  接口每页条数,
  默认接口分页并发数,
  解析接口响应,
  复制可复用请求头,
  构建接口分页进度,
  构建分页请求体,
  分批读取接口页列表,
  读取全部发票申请单,
};
