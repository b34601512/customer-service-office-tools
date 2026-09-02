const fs = require('fs');
const path = require('path');
const { 登录态文件路径 } = require('../common/paths');
const { 打印日志 } = require('../common/logger');
const { 获取订单下载目录, 清理文件名片段 } = require('../invoices/invoiceFileStore');
const {
  创建诺诺浏览器会话,
  创建或复用诺诺浏览器会话,
  关闭诺诺浏览器会话,
  关闭共享诺诺浏览器会话,
} = require('./nuonuoBrowserSession');

const 诺诺开票记录页地址 = 'https://work.nuonuo.com/micro/nstSales/record';
const 下载文件类型配置 = {
  pdf: { field: 'pdf_url', extension: '.pdf' },
  ofd: { field: 'ofdDownloadUrl', extension: '.ofd' },
  xml: { field: 'xmlUrl', extension: '.xml' },
};

function 格式化日期(date) {
  // 这个函数解决诺诺兜底查询接口只接受 yyyy-MM-dd 日期格式的问题。
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function 构建最近日期范围(rangeDays = 30, now = new Date()) {
  // 这个函数解决快速查询找不到时，兜底列表查询默认只查最近30天。
  const days = Number.isFinite(Number(rangeDays)) ? Number(rangeDays) : 30;
  const endDate = new Date(now);
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - Math.max(0, days - 1));
  return {
    dateStart: 格式化日期(startDate),
    dateEnd: 格式化日期(endDate),
  };
}

function 构建快速查询请求体(orderNumber, orderNoType) {
  // 这个函数解决诺诺快速查询接口参数必须和页面真实请求保持一致的问题。
  const params = new URLSearchParams();
  params.set('name_order', String(orderNumber || '').trim());
  params.set('orderNoType', String(orderNoType));
  params.set('search_type', '1');
  params.set('invoice_status', '');
  params.set('pCount', '20');
  params.set('current', '1');
  return params.toString();
}

function 构建列表查询请求体({ dateStart, dateEnd, current = 1, pCount = 20 } = {}) {
  // 这个函数解决兜底查询接口参数必须与诺诺页面真实请求保持一致的问题。
  const params = new URLSearchParams();
  params.set('dateStart', dateStart || '');
  params.set('dateEnd', dateEnd || '');
  params.set('fphmStart', '');
  params.set('fphmEnd', '');
  params.set('invoiceLine', '');
  params.set('buyerName', '');
  params.set('buyerNameQueryType', '0');
  params.set('invalidStatus', '');
  params.set('fpdm', '');
  params.set('phoneOrEmail', '');
  params.set('kpType', '');
  params.set('listFlag', '');
  params.set('requestSrc', '');
  params.set('invoiceNature', '');
  params.set('extNum', '');
  params.set('machineCode', '');
  params.set('dept', '[{\"type\":\"0\",\"id\":\"\"}]');
  params.set('time-type', '0');
  params.set('invoice_status', '');
  params.set('pCount', String(pCount));
  params.set('current', String(current));
  return params.toString();
}

function 解析发票查询列表(responseData) {
  // 这个函数解决诺诺接口响应结构变化时只在一个地方校验列表。
  if (responseData?.status !== 200) {
    throw new Error(`诺诺发票查询失败：${responseData?.message || '接口状态异常'}`);
  }
  const list = responseData?.data?.list;
  return Array.isArray(list) ? list : [];
}

function 是否开票完成(record) {
  // 这个函数解决只有开票完成的记录才允许进入下载阶段。
  return String(record?.c_status || '').includes('开票完成') || Number(record?.invoiceState) === 1;
}

function 获取发票下载地址(record, fileType = 'pdf') {
  // 这个函数解决 PDF、OFD、XML 下载地址字段不一样的问题。
  const config = 下载文件类型配置[fileType];
  if (!config) throw new Error(`不支持的发票文件类型：${fileType}`);
  return String(record?.[config.field] || '').trim();
}

function 选择可下载发票记录(records, fileType = 'pdf') {
  // 这个函数解决同一个订单返回多条记录时优先选择已完成且有下载地址的发票。
  return records.find((record) => 是否开票完成(record) && 获取发票下载地址(record, fileType));
}

async function 提交诺诺页面接口(page, apiPath, formBody) {
  // 这个函数解决诺诺接口必须使用页面自己的登录上下文，不能脱离页面硬调。
  const result = await page.evaluate(async ({ apiPath: innerApiPath, formBody: innerFormBody }) => {
    const response = await fetch(`${innerApiPath}?_=${Date.now()}`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: innerFormBody,
      credentials: 'include',
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  }, { apiPath, formBody });
  if (!result.ok) {
    throw new Error(`诺诺接口异常：HTTP ${result.status}`);
  }
  return JSON.parse(result.text);
}

async function 提交诺诺JSON接口(page, apiPath, payload = {}) {
  // 这个函数解决诺诺主体切换这类 JSON 接口也必须走页面登录上下文。
  const result = await page.evaluate(async ({ apiPath: innerApiPath, payload: innerPayload }) => {
    const response = await fetch(innerApiPath, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json;charset=UTF-8',
      },
      body: JSON.stringify(innerPayload),
      credentials: 'include',
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  }, { apiPath, payload });
  if (!result.ok) throw new Error(`诺诺接口异常：HTTP ${result.status}`);
  return JSON.parse(result.text);
}

function 解析主体列表(responseData) {
  // 这个函数解决诺诺公司列表接口结构变化时集中校验。
  if (responseData?.code !== 200) {
    throw new Error(`诺诺主体列表读取失败：${responseData?.message || '接口状态异常'}`);
  }
  const data = responseData.data || {};
  return {
    defaultCompanyId: String(data.defaultCompanyId || ''),
    companies: Array.isArray(data.switchCompanyList) ? data.switchCompanyList.map((company) => ({
      id: String(company.id || ''),
      name: String(company.name || ''),
      taxNum: String(company.taxNum || ''),
      employeeId: String(company.employeeId || ''),
    })).filter((company) => company.id) : [],
  };
}

function 排列主体查询顺序(companies, defaultCompanyId) {
  // 这个函数解决多主体查询要先查当前默认主体，再查其它主体。
  const 默认主体 = companies.find((company) => company.id === defaultCompanyId);
  const 其它主体 = companies.filter((company) => company.id !== defaultCompanyId);
  return 默认主体 ? [默认主体, ...其它主体] : companies;
}

async function 查询诺诺主体列表(page) {
  // 这个函数解决发票可能开在不同主体下，需要先读取可切换公司。
  return 解析主体列表(await 提交诺诺JSON接口(page, '/web/index/companyList.do', {}));
}

async function 切换诺诺主体(page, company) {
  // 这个函数解决跨主体查询前先用诺诺官方接口切换当前公司。
  if (!company?.id) throw new Error('切换诺诺主体失败：主体 ID 为空。');
  const response = await 提交诺诺JSON接口(page, '/web/index/company/select.do', { companyId: company.id });
  if (response?.success === false || response?.code >= 400) {
    throw new Error(`切换诺诺主体失败：${response?.message || company.name}`);
  }
  await page.goto(诺诺开票记录页地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
}

async function 创建诺诺查询页面({
  headless = true,
  createBrowserSession = 创建诺诺浏览器会话,
  authStateFileExists = () => fs.existsSync(登录态文件路径),
} = {}) {
  // 这个函数解决使用已保存登录态打开诺诺页面，并为后续接口请求提供同一会话。
  if (!authStateFileExists()) {
    throw new Error('诺诺登录态不存在，请先在命令行菜单执行“检查诺诺登录”。');
  }
  const 浏览器会话 = await createBrowserSession({
    headless,
    useSavedAuthState: true,
    acceptDownloads: true,
  });
  try {
    await 浏览器会话.page.goto(诺诺开票记录页地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await 浏览器会话.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    if (/login|usercenter\/allow\/login/i.test(浏览器会话.page.url())) {
      throw new Error('诺诺登录态已失效，请先在命令行菜单执行“检查诺诺登录”重新登录。');
    }
    return 浏览器会话;
  } catch (error) {
    await 关闭诺诺浏览器会话(浏览器会话);
    throw error;
  }
}

async function 查询诺诺发票记录(page, orderNumber, fileType = 'pdf') {
  // 这个函数解决同一个订单号在诺诺里可能被当成开票单号或订单编号的问题。
  for (const orderNoType of [0, 1]) {
    const responseData = await 提交诺诺页面接口(
      page,
      '/api/nstSales/invoice/webkp/invoiceList/queryInvoiceListByFast.do',
      构建快速查询请求体(orderNumber, orderNoType),
    );
    const records = 解析发票查询列表(responseData);
    const record = 选择可下载发票记录(records, fileType);
    if (record) return { record, orderNoType };
  }
  return null;
}

async function 兜底查询最近发票记录(page, orderNumber, { fileType = 'pdf', rangeDays = 30 } = {}) {
  // 这个函数解决快速查询找不到时，再按最近时间范围扫描列表结果。
  const { dateStart, dateEnd } = 构建最近日期范围(rangeDays);
  const responseData = await 提交诺诺页面接口(
    page,
    '/api/nstSales/invoice/webkp/invoiceList/queryInvoiceList.do',
    构建列表查询请求体({ dateStart, dateEnd, current: 1, pCount: 100 }),
  );
  const records = 解析发票查询列表(responseData);
  const orderText = String(orderNumber || '').trim();
  const matchedRecords = records.filter((record) => [
    record.c_orderno,
    record.extNum,
    record.bField1,
    record.bField2,
    record.bField3,
    record.remark,
    record.c_fpqqlsh,
  ].some((value) => String(value || '').includes(orderText)));
  const record = 选择可下载发票记录(matchedRecords, fileType);
  return record ? { record, orderNoType: 'range-fallback' } : null;
}

async function 下载发票文件(page, record, orderNumber, fileType = 'pdf') {
  // 这个函数解决从诺诺返回的真实下载地址保存本地发票文件。
  const config = 下载文件类型配置[fileType];
  const downloadUrl = 获取发票下载地址(record, fileType);
  if (!downloadUrl) throw new Error(`订单 ${orderNumber} 缺少 ${fileType.toUpperCase()} 下载地址。`);
  const response = await page.request.get(downloadUrl, { timeout: 60_000 });
  if (!response.ok()) {
    throw new Error(`订单 ${orderNumber} 发票下载失败：HTTP ${response.status()}`);
  }
  const buffer = await response.body();
  if (!buffer.length) {
    throw new Error(`订单 ${orderNumber} 发票下载失败：文件为空。`);
  }
  const invoiceFilePath = path.join(获取订单下载目录(orderNumber), `${清理文件名片段(orderNumber)}${config.extension}`);
  fs.writeFileSync(invoiceFilePath, buffer);
  return invoiceFilePath;
}

async function 查询并下载当前主体发票(page, orders, { fileType, invoiceSearchRangeDays, company }) {
  // 这个函数解决在单个主体内批量查询订单并下载找到的发票。
  const results = [];
  for (const [index, order] of orders.entries()) {
    const orderNumber = String(order?.orderNumber || order || '').trim();
    if (!orderNumber) continue;
    打印日志('诺诺下载', '接口查询', `开始查询第 ${index + 1}/${orders.length} 单：${company?.name || '当前主体'} ${orderNumber}`);
    const queryResult = await 查询诺诺发票记录(page, orderNumber, fileType)
      || await 兜底查询最近发票记录(page, orderNumber, {
        fileType,
        rangeDays: invoiceSearchRangeDays,
      });
    if (!queryResult) {
      打印日志('诺诺下载', '接口查询', `当前主体未找到：${company?.name || '当前主体'} ${orderNumber}`);
      continue;
    }
    const invoiceFilePath = await 下载发票文件(page, queryResult.record, orderNumber, fileType);
    results.push({
      ...order,
      orderNumber,
      invoiceFilePath,
      source: 'nuonuo-api',
      invoiceNumber: queryResult.record.allElectronicInvoiceNumber || queryResult.record.fphm || '',
      invoiceBuyerName: queryResult.record.buyerName
        || queryResult.record.gfmc
        || queryResult.record.gmfmc
        || queryResult.record.purchaserName
        || queryResult.record.buyer_name
        || '',
      nuonuoOrderNoType: queryResult.orderNoType,
      nuonuoCompanyName: company?.name || '',
      nuonuoCompanyTaxNum: company?.taxNum || '',
    });
    打印日志('诺诺下载', '接口下载', `发票下载完成：${company?.name || '当前主体'} ${orderNumber}`);
  }
  return results;
}

async function 批量查询并下载诺诺发票({ orders = [], fileType = 'pdf', headless = true, invoiceSearchRangeDays = 30, invoiceSystemConfig = {} } = {}) {
  // 这个函数解决同一下载中心进程内复用诺诺会话，避免每个请求关闭临时浏览器导致登录态每天失效。
  const 待下载订单 = Array.isArray(orders) ? orders : [];
  if (!待下载订单.length) return [];
  let page = null;
  let 原始主体 = null;
  let 当前主体ID = '';
  try {
    const 浏览器会话 = await 创建或复用诺诺浏览器会话({
      headless,
      useSavedAuthState: true,
      acceptDownloads: true,
    });
    page = 浏览器会话.page;
    await page.goto(诺诺开票记录页地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    if (/login|usercenter\/allow\/login/i.test(page.url())) {
      throw new Error('诺诺登录态已失效，请先完成网页登录。');
    }
    const 主体信息 = await 查询诺诺主体列表(page);
    const 主体列表 = invoiceSystemConfig.searchAllInvoiceSubjects === false
      ? 排列主体查询顺序(主体信息.companies, 主体信息.defaultCompanyId).slice(0, 1)
      : 排列主体查询顺序(主体信息.companies, 主体信息.defaultCompanyId);
    原始主体 = 主体列表.find((company) => company.id === 主体信息.defaultCompanyId) || 主体列表[0] || null;
    const results = [];
    const 已找到订单号集合 = new Set();
    for (const company of 主体列表) {
      const 剩余订单 = 待下载订单.filter((order) => !已找到订单号集合.has(String(order?.orderNumber || order || '').trim()));
      if (!剩余订单.length) break;
      await 切换诺诺主体(page, company);
      当前主体ID = company.id;
      const 当前主体结果 = await 查询并下载当前主体发票(page, 剩余订单, {
        fileType,
        invoiceSearchRangeDays: invoiceSystemConfig.invoiceSearchRangeDays || invoiceSearchRangeDays,
        company,
      });
      当前主体结果.forEach((invoice) => 已找到订单号集合.add(invoice.orderNumber));
      results.push(...当前主体结果);
    }
    return results;
  } catch (error) {
    const message = String(error?.message || error || '');
    if (/登录态|未登录|登录失败|登录失效|登录页/.test(message)) {
      await 关闭共享诺诺浏览器会话();
    }
    throw error;
  } finally {
    if (原始主体?.id && 当前主体ID && 当前主体ID !== 原始主体.id) {
      await 切换诺诺主体(page, 原始主体).catch(() => {});
    }
    // 会话由下载中心进程持有，服务退出时统一关闭；单次下载完成不再关闭浏览器。
  }
}

module.exports = {
  诺诺开票记录页地址,
  格式化日期,
  构建最近日期范围,
  构建快速查询请求体,
  构建列表查询请求体,
  解析发票查询列表,
  解析主体列表,
  排列主体查询顺序,
  是否开票完成,
  获取发票下载地址,
  选择可下载发票记录,
  提交诺诺页面接口,
  提交诺诺JSON接口,
  查询诺诺主体列表,
  切换诺诺主体,
  创建诺诺查询页面,
  查询诺诺发票记录,
  兜底查询最近发票记录,
  下载发票文件,
  批量查询并下载诺诺发票,
};
