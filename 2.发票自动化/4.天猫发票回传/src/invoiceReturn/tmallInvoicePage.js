const fs = require('fs');
const path = require('path');
const { 等待天猫登录完成, 是天猫登录页面 } = require('../browser/tmallAuthenticatedPage');
const { 打印日志 } = require('../common/logger');
const { 截图目录, 规范化店铺标识 } = require('../common/paths');

const 天猫待回传发票页面地址 = 'https://myseller.taobao.com/home.htm/merchant-invoice/invoice/compensate#/invoice/compensate';
const 发票类型列表 = [
  '增值税电子普通发票',
  '增值税纸质普通发票',
  '全电普通发票',
  '增值税电子专用发票',
  '增值税纸质专用发票',
  '全电专用发票',
];
const 滑块验证特征列表 = ['拖动滑块', '滑动验证', '请完成验证', '安全验证', '向右拖动'];
const 滑块组件选择器 = '#nc_1_wrapper, .nc_wrapper, [class*="nc_iconfont"], [id*="nc_"]';
const 滑块等待总上限毫秒 = 10 * 60_000;

function 等待短间隔(ms) {
  // 解决：页面状态轮询需要短暂让出事件循环，但不依赖固定等待成功。
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function 读取页面正文(page) {
  // 解决：页面状态判断统一从可见文本读取，便于后续替换判断规则。
  return page.locator('body').innerText({ timeout: 15_000 });
}

async function 等待页面状态(page, label, timeoutMs, predicate) {
  // 解决：天猫后台加载时间不稳定，按状态等，不按固定秒数猜。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = await 读取页面正文(page).catch(() => '');
    if (predicate(text)) return text;
    await 等待短间隔(1000);
  }
  throw new Error(`${label}超时。`);
}

function 是天猫待回传列表文本(text) {
  // 解决：待回传页面加载完成必须同时出现导出按钮和订单或空列表状态。
  const 正文 = String(text || '');
  return 正文.includes('批量导出') && (/\b\d{18,}\b/.test(正文) || /暂无数据|没有数据|无数据/.test(正文));
}

function 读取天猫待回传页面状态(url, text) {
  // 解决：业务动作遇到登录页要先登录，不应该一直等列表超时。
  if (是天猫登录页面(url)) {
    return 'login';
  }
  if (是天猫待回传列表文本(text)) {
    return 'ready';
  }
  return 'loading';
}

async function 检测滑块验证(page) {
  // 解决：天猫数据接口在滑块未完成时不返回列表数据，页面会误显示“没有数据”；
  // 检测到滑块时必须停下等人工完成，否则会把空列表当成真实结果。
  try {
    const text = await 读取页面正文(page).catch(() => '');
    if (滑块验证特征列表.some((特征) => text.includes(特征))) {
      return true;
    }
    const count = await page.locator(滑块组件选择器).count().catch(() => 0);
    return count > 0;
  } catch {
    return false;
  }
}

async function 等待天猫待回传列表或登录页(page, timeoutMs = 120_000) {
  // 解决：同时等待列表就绪和登录拦截，避免未登录时白等两分钟。
  let startedAt = Date.now();
  let 滑块首次出现时间 = 0;
  let 已提示滑块 = false;
  while (Date.now() - startedAt < timeoutMs) {
    const text = await 读取页面正文(page).catch(() => '');
    const 有滑块 = await 检测滑块验证(page);
    if (有滑块) {
      startedAt = Date.now();
      if (!滑块首次出现时间) {
        滑块首次出现时间 = Date.now();
      }
      if (Date.now() - 滑块首次出现时间 > 滑块等待总上限毫秒) {
        throw new Error('等待滑块验证完成超时，请确认是否已在页面完成验证后重试。');
      }
      if (!已提示滑块) {
        已提示滑块 = true;
        打印日志('天猫登录', '滑块验证', '检测到滑动验证，程序已暂停自动操作，请在弹出的窗口完成滑块，完成后自动继续');
      }
      await page.bringToFront().catch(() => {});
      await 等待短间隔(1000);
      continue;
    }
    const state = 读取天猫待回传页面状态(page.url(), text);
    if (state === 'ready' || state === 'login') {
      return { state, text, url: page.url() };
    }
    await 等待短间隔(1000);
  }
  throw new Error('等待天猫待回传列表加载超时。');
}

async function 打开天猫待回传发票页面(page, 店铺配置 = {}, 选项 = {}) {
  // 解决：所有回传动作都从同一个业务页面进入，避免依赖首页跳转状态。
  const { 登录等待超时毫秒 = 15 * 60_000 } = 选项;
  await page.goto(天猫待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.bringToFront().catch(() => {});
  const 首次状态 = await 等待天猫待回传列表或登录页(page);
  if (首次状态.state === 'ready') {
    return 首次状态.text;
  }
  await 等待天猫登录完成(page, 店铺配置, {
    timeoutMs: 登录等待超时毫秒,
    目标地址: 天猫待回传发票页面地址,
  });
  await page.goto(天猫待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  return 等待天猫待回传列表加载(page);
}

async function 等待天猫待回传列表加载(page) {
  // 解决：列表接口比 DOMContentLoaded 慢，必须等订单或空列表状态出现。
  const result = await 等待天猫待回传列表或登录页(page);
  if (result.state === 'login') {
    throw new Error(`天猫待回传页面需要登录：${result.url}`);
  }
  return result.text;
}

function 提取行内发票类型(rowText) {
  // 解决：天猫表格没有稳定字段对象，先从已验证的发票类型文案中提取。
  return 发票类型列表.find((type) => String(rowText || '').includes(type)) || '';
}

function 提取行内发票金额(rowText) {
  // 解决：表格行文本里金额靠近操作列，取最后一个两位小数金额作为开票金额。
  const matches = Array.from(String(rowText || '').matchAll(/\b\d+(?:\.\d{2})\b/g)).map((item) => item[0]);
  return matches[matches.length - 1] || '';
}

function 提取行内发票抬头(rowText, invoiceType) {
  // 解决：抬头在“免自动赔”和发票类型之间，提取失败时保留空值不猜。
  const text = String(rowText || '').replace(/\s+/g, ' ').trim();
  if (!invoiceType) return '';
  const match = text.match(new RegExp(`免自动赔\\s+(.+?)\\s+${转义正则文本(invoiceType)}`));
  return match ? match[1].trim() : '';
}

function 提取行内申请时间(rowText) {
  // 解决：天猫列表行的订单号后面跟申请日期，先从真实行文本里提取，不猜导出文件结构。
  const text = String(rowText || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/\b\d{18,}\b\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/);
  return match ? match[1].trim() : '';
}

function 提取行内赔付倒计时(rowText) {
  const text = String(rowText || '').replace(/\s+/g, ' ').trim();
  return text.match(/\b\d+\s*天(?:\d+\s*小时)?(?:\d+\s*分)?(?:\d+\s*秒)?/)?.[0]?.replace(/\s+/g, '') || '';
}

function 提取行内批准状态(rowText) {
  const text = String(rowText || '');
  if (text.includes('已准') || text.includes('已同意')) return '已批准';
  if (text.includes('待同意') || text.includes('同意')) return '待批准';
  return '未识别';
}

function 解析天猫列表日期时间(value) {
  // 解决：申请时间要计算财务参考，统一把列表日期转成 Date。
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) return null;
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function 是否自然周工作日(date) {
  // 解决：财务参考只按周一到周五粗略估算，不把法定节假日伪装成精确算法。
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function 复制日期到当天零点(date) {
  // 解决：工作日计算只比较日期，避免时分秒影响结果。
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function 计算已过工作日数(startDate, endDate) {
  // 解决：让用户知道申请后已经等了几个工作日。
  const cursor = 复制日期到当天零点(startDate);
  const target = 复制日期到当天零点(endDate);
  if (cursor >= target) return 0;
  let count = 0;
  while (cursor < target) {
    cursor.setDate(cursor.getDate() + 1);
    if (是否自然周工作日(cursor)) count += 1;
  }
  return count;
}

function 计算第几个工作日日期(startDate, workdayCount) {
  // 解决：给出财务常规开票的大概日期，减少人工反复判断。
  const cursor = 复制日期到当天零点(startDate);
  let count = 0;
  while (count < workdayCount) {
    cursor.setDate(cursor.getDate() + 1);
    if (是否自然周工作日(cursor)) count += 1;
  }
  return cursor;
}

function 格式化天猫参考日期(date) {
  // 解决：财务参考只展示到日期，避免订单表变得太吵。
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function 构建天猫财务开票参考(invoiceApplyTime, now = new Date()) {
  // 解决：把“财务约 7 个工作日开票”的经验固定显示到订单行里。
  const applyDate = 解析天猫列表日期时间(invoiceApplyTime);
  if (!applyDate) return invoiceApplyTime ? '财务参考：申请时间格式未识别' : '财务参考：未获取申请时间';
  const elapsedWorkdays = 计算已过工作日数(applyDate, now);
  if (elapsedWorkdays >= 7) {
    return `财务参考：已过 ${elapsedWorkdays} 个工作日，超过常规 7 个工作日`;
  }
  const estimatedDate = 计算第几个工作日日期(applyDate, 7);
  return `财务参考：已过 ${elapsedWorkdays} 个工作日，常规约 7 个工作日，预计 ${格式化天猫参考日期(estimatedDate)} 前后`;
}

async function 读取当前页订单行文本列表(page) {
  // 解决：页面订单识别统一从真实可见行读取，避免回传判定和报错解释各读一套规则。
  return page.evaluate(() => {
    const 可见 = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return Array.from(document.querySelectorAll('tr, [role="row"]'))
      .filter(可见)
      .map((element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => /\b\d{18,}\b/.test(text));
  });
}

function 提取行内订单号(rowText) {
  // 解决：报错和回传都只展示订单号本身，不把税号等其它长数字当成业务身份。
  return String(rowText || '').match(/\b\d{18,}\b/)?.[0] || '';
}

function 读取行内天猫操作状态(rowText) {
  // 解决：让用户知道程序看到的是“录入发票”还是“同意/详情”等未回传状态。
  const text = String(rowText || '');
  if (text.includes('录入发票')) return '可录入发票';
  if (text.includes('同意')) return '待同意';
  if (text.includes('详情')) return '仅详情';
  return '未识别操作';
}

async function 读取当前页发票订单状态摘要(page) {
  // 解决：没有可回传订单时，把页面真实订单状态带回报错，避免用户看到订单却不知道为什么不回传。
  const rows = await 读取当前页订单行文本列表(page);
  const 订单映射 = new Map();
  for (const rowText of rows) {
    const orderNumber = 提取行内订单号(rowText);
    if (!orderNumber || 订单映射.has(orderNumber)) continue;
    订单映射.set(orderNumber, {
      orderNumber,
      operationStatus: 读取行内天猫操作状态(rowText),
    });
  }
  const 订单列表 = Array.from(订单映射.values());
  return {
    visibleOrderCount: 订单列表.length,
    returnableOrderCount: 订单列表.filter((order) => order.operationStatus === '可录入发票').length,
    pendingAgreeOrderCount: 订单列表.filter((order) => order.operationStatus === '待同意').length,
    detailOnlyOrderCount: 订单列表.filter((order) => order.operationStatus === '仅详情').length,
    unknownStatusOrderCount: 订单列表.filter((order) => order.operationStatus === '未识别操作').length,
    exampleOrderNumbers: 订单列表.slice(0, 5).map((order) => order.orderNumber),
  };
}

function 格式化天猫订单示例(exampleOrderNumbers) {
  // 解决：长订单列表只展示少量样例，报错保持可读且足够定位。
  const 订单号列表 = (Array.isArray(exampleOrderNumbers) ? exampleOrderNumbers : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!订单号列表.length) return '';
  return `订单示例：${订单号列表.join('、')}。`;
}

function 构建天猫无可回传订单错误消息(状态摘要 = {}) {
  // 解决：把“没有可回传”解释成可核对的判定规则，而不是只给用户一个结论。
  const visibleOrderCount = Number(状态摘要.visibleOrderCount || 0);
  const returnableOrderCount = Number(状态摘要.returnableOrderCount || 0);
  const pendingAgreeOrderCount = Number(状态摘要.pendingAgreeOrderCount || 0);
  const detailOnlyOrderCount = Number(状态摘要.detailOnlyOrderCount || 0);
  const unknownStatusOrderCount = Number(状态摘要.unknownStatusOrderCount || 0);
  const parts = [
    '已跳过：当前列表没有可回传订单。',
    `判定规则：程序只回传操作列出现“录入发票”的订单；当前页面识别到 ${visibleOrderCount} 个订单，其中 ${returnableOrderCount} 个包含“录入发票”。`,
  ];
  if (pendingAgreeOrderCount > 0 || detailOnlyOrderCount > 0 || unknownStatusOrderCount > 0) {
    parts.push(`未进入回传阶段的订单：待同意 ${pendingAgreeOrderCount} 个，仅详情 ${detailOnlyOrderCount} 个，未识别操作 ${unknownStatusOrderCount} 个。`);
  }
  const exampleText = 格式化天猫订单示例(状态摘要.exampleOrderNumbers);
  if (exampleText) parts.push(exampleText);
  parts.push('原因说明：看到订单不等于可回传；需先由客服登记、财务开票，发票系统有可下载发票后，天猫操作列出现“录入发票”才会回传。');
  return parts.join(' ');
}

async function 读取当前页待回传订单(page, 店铺配置) {
  // 解决：同步与回传都读取后台待回传列表的全部订单，不再只保留操作列含“录入发票”的行；
  // 发票是否已开好由下载中心逐单判断（没有可下载发票时跳过），避免同步提示成功却没有任何记录。
  const rows = await 读取当前页订单行文本列表(page);
  const 已存在订单号 = new Set();
  return rows.map((rowText) => {
    const orderNumber = 提取行内订单号(rowText);
    const operationStatus = 读取行内天猫操作状态(rowText);
    const invoiceType = 提取行内发票类型(rowText);
    const invoiceApplyTime = 提取行内申请时间(rowText);
    return {
      key: `${店铺配置.id}:${orderNumber}`,
      storeId: 店铺配置.id,
      storeName: 店铺配置.name,
      orderNumber,
      operationStatus,
      invoiceAmount: 提取行内发票金额(rowText),
      invoiceType,
      invoiceApplyTime,
      compensationCountdown: 提取行内赔付倒计时(rowText),
      approvalStatus: 提取行内批准状态(rowText),
      promisedInvoiceTime: '',
      financeIssueReference: 构建天猫财务开票参考(invoiceApplyTime),
      invoiceTitle: 提取行内发票抬头(rowText, invoiceType),
      rowText,
    };
  }).filter((order) => {
    if (!order.orderNumber || 已存在订单号.has(order.orderNumber)) return false;
    已存在订单号.add(order.orderNumber);
    return true;
  });
}

function 生成导出文件名(suggestedFilename) {
  // 解决：天猫下载文件名可能重复，落盘时加时间戳保证可追溯。
  const safeName = String(suggestedFilename || 'invoice_rights.csv').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_');
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeName}`;
}

function 转换天猫导出下载错误(错误) {
  // 解决：Playwright 底层错误转成用户能判断的天猫导出原因。
  const message = String(错误?.message || 错误 || '').trim();
  if (/Target page, context or browser has been closed/i.test(message)) {
    return new Error('天猫批量导出失败：等待下载文件时页面或浏览器被关闭。');
  }
  if (/Timeout/i.test(message)) {
    return new Error('天猫批量导出失败：等待下载文件超时，可能是天猫没有生成下载文件或登录状态失效。');
  }
  return new Error(`天猫批量导出失败：等待下载文件失败。${message}`);
}

async function 等待天猫导出下载(downloadPromise) {
  // 解决：集中等待下载事件，失败时抛出明确中文错误。
  try {
    return await downloadPromise;
  } catch (错误) {
    throw 转换天猫导出下载错误(错误);
  }
}

async function 确认天猫批量导出按钮可用(page) {
  // 解决：按钮禁用时先判断页面业务状态，不把 Playwright 原始重试日志抛给用户。
  const 批量导出按钮 = page.locator('button').filter({ hasText: /^批量导出$/ }).first();
  await 批量导出按钮.waitFor({ state: 'visible', timeout: 10_000 });
  if (await 批量导出按钮.isEnabled().catch(() => false)) {
    return 批量导出按钮;
  }
  const 当前页摘要 = await 读取当前页发票订单状态摘要(page).catch(() => ({
    visibleOrderCount: 0,
    returnableOrderCount: 0,
  }));
  if (当前页摘要.returnableOrderCount === 0) {
    throw new Error(`天猫批量导出不可用：${构建天猫无可回传订单错误消息(当前页摘要)}`);
  }
  throw new Error(`天猫批量导出不可用：页面已有 ${当前页摘要.returnableOrderCount} 单待回传订单，但批量导出按钮仍是禁用状态，请刷新页面后重试。`);
}

async function 导出天猫待回传订单(page, outputDirectory, 选项 = {}) {
  // 解决：先触发天猫批量导出留痕，后续订单读取仍以页面真实列表为准。
  const {
    onAction = null,
    confirmTimeoutMs = 30_000,
    downloadTimeoutMs = 120_000,
  } = 选项;
  const 通知导出动作 = (message) => {
    if (typeof onAction === 'function') onAction(message);
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  通知导出动作('正在等待天猫待回传列表加载。');
  await 等待天猫待回传列表加载(page);
  const 批量导出按钮 = await 确认天猫批量导出按钮可用(page);
  通知导出动作('正在点击批量导出。');
  const downloadPromise = page.waitForEvent('download', { timeout: downloadTimeoutMs });
  downloadPromise.catch(() => {});
  // 经验：拼多多曾遇到右侧悬浮层拦截批量导出，天猫目前未采集到稳定遮挡选择器；后续如复现，先现场采集真实 selector，再按“关闭浮层或 DOM click”方式处理。
  await 批量导出按钮.click();
  通知导出动作('正在等待批量导出确认弹窗。');
  await 等待页面状态(page, '等待批量导出确认弹窗', confirmTimeoutMs, (text) => String(text || '').includes('申请数据可能包含消费者提供的敏感信息'));
  通知导出动作('正在确认批量导出。');
  await page.locator('.next-dialog button, [role="dialog"] button, button').filter({ hasText: /^确定$/ }).last().click();
  通知导出动作('正在等待天猫生成导出文件。');
  const download = await 等待天猫导出下载(downloadPromise);
  const exportFilePath = path.join(outputDirectory, 生成导出文件名(download.suggestedFilename()));
  通知导出动作('正在保存天猫导出文件。');
  await download.saveAs(exportFilePath);
  const failure = await download.failure();
  if (failure) throw new Error(`天猫批量导出失败：${failure}`);
  return exportFilePath;
}

async function 搜索天猫回传订单(page, orderNumber) {
  // 解决：上传前先按订单号过滤，避免点错其它行的录入发票。
  const 订单号 = String(orderNumber || '').trim();
  if (!订单号) throw new Error('搜索天猫回传订单失败：订单号为空。');
  await page.locator('#tid').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#tid').fill(订单号);
  await page.locator('button').filter({ hasText: /^搜索$/ }).first().click();
  await 等待页面状态(page, `等待订单 ${订单号} 搜索结果`, 60_000, (text) => String(text || '').includes(订单号) && String(text || '').includes('录入发票'));
}

async function 打开录入发票抽屉(page, orderNumber) {
  // 解决：只在目标订单所在行点击录入发票，避免页面上多个同名操作混淆。
  const row = page.locator('tr, [role="row"]').filter({ hasText: String(orderNumber) }).first();
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.locator('text=录入发票').last().click();
  await 等待页面状态(page, '等待录入发票抽屉打开', 30_000, (text) => {
    const 正文 = String(text || '');
    return 正文.includes('录入发票信息') && 正文.includes(String(orderNumber)) && 正文.includes('上传发票');
  });
}

async function 上传发票文件(page, invoiceFilePath) {
  // 解决：优先使用已采集到的隐藏 input，失败时再走页面 filechooser。
  if (!fs.existsSync(invoiceFilePath)) {
    throw new Error(`上传发票失败：文件不存在 ${invoiceFilePath}`);
  }
  const hiddenInput = page.locator('input#tsfFileName[type="file"], input[type="file"][name="file"]').last();
  if (await hiddenInput.count()) {
    await hiddenInput.setInputFiles(invoiceFilePath);
  } else {
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 });
    await page.getByText('上传发票PDF/OFD', { exact: true }).last().click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(invoiceFilePath);
  }
  await 等待页面状态(page, '等待发票解析完成', 180_000, (text) => {
    const 正文 = String(text || '');
    return 正文.includes('解析成功') || 正文.includes(path.basename(invoiceFilePath));
  });
}

function 选择目标发票类型({ invoiceNumber = '', invoiceType = '' } = {}) {
  // 解决：天猫要求 20 位发票号码选择全电类型，否则会阻止完成开票。
  const 发票号码 = String(invoiceNumber || '').trim();
  const 原发票类型 = String(invoiceType || '').trim();
  if (/^\d{20}$/.test(发票号码)) {
    return 原发票类型.includes('专用') ? '全电专用发票' : '全电普通发票';
  }
  if (发票类型列表.includes(原发票类型)) return 原发票类型;
  return '';
}

async function 读取输入框值(page, selector) {
  // 解决：天猫 OCR 结果写入 input.value，正文文本里只有字段名，必须直接读输入框。
  const 输入框 = page.locator(selector).first();
  if (await 输入框.count() === 0) {
    return '';
  }
  return String(await 输入框.inputValue().catch(() => '') || '').trim();
}

async function 读取已识别发票号码(page) {
  // 解决：解析后发票号码优先读取真实输入框，避免被页面标签文本误导。
  const 输入框号码 = await 读取输入框值(page, '#invoiceNo');
  if (/^\d{8,20}$/.test(输入框号码)) {
    return 输入框号码;
  }
  const text = await 读取页面正文(page);
  const match = String(text || '').replace(/\s+/g, ' ').match(/发票号码\s*(\d{8,20})/);
  return match ? match[1] : '';
}

async function 等待已识别发票号码(page, timeoutMs = 180_000) {
  // 解决：文件名出现不等于 OCR 完成，必须等发票号码真正写入页面。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const invoiceNumber = await 读取已识别发票号码(page).catch(() => '');
    if (/^\d{8,20}$/.test(invoiceNumber)) {
      return invoiceNumber;
    }
    await 等待短间隔(500);
  }
  throw new Error('等待天猫识别发票号码超时。');
}

function 转义正则文本(text) {
  // 解决：发票类型文案进入正则前必须转义，避免特殊字符破坏完整匹配。
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function 标准化可见文本(text) {
  // 解决：标签内部可能包含换行或多余空格，比较前统一压成单行。
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function 定位天猫发票类型标签(page, targetType) {
  // 解决：真实页面需要点击外层 checkable tag，不能点击内部文字节点。
  const 完整文本 = new RegExp(`^\\s*${转义正则文本(targetType)}\\s*$`);
  const 标签列表 = page.locator('[role="checkbox"], .next-tag').filter({ hasText: 完整文本 });
  const 标签数量 = await 标签列表.count();
  for (let index = 0; index < 标签数量; index += 1) {
    const 标签 = 标签列表.nth(index);
    if (!await 标签.isVisible().catch(() => false)) continue;
    const 标签文本 = 标准化可见文本(await 标签.innerText().catch(() => ''));
    if (标签文本 === targetType) return 标签;
  }
  throw new Error(`天猫发票类型选择失败：没有找到可点击的外层标签「${targetType}」。`);
}

async function 发票类型标签已选中(tagLocator) {
  // 解决：天猫标签选中状态同时可能落在 aria-checked 或 checked class 上。
  return tagLocator.evaluate((element) => {
    const ariaChecked = element.getAttribute('aria-checked');
    const className = String(element.className || '');
    return ariaChecked === 'true' || /\bchecked\b/.test(className);
  }).catch(() => false);
}

async function 等待发票类型选中(page, targetType, timeoutMs = 15_000) {
  // 解决：点完类型后等待真实选中态，不用固定等待猜页面是否完成切换。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const 标签 = await 定位天猫发票类型标签(page, targetType).catch(() => null);
    if (标签 && await 发票类型标签已选中(标签)) {
      return true;
    }
    await 等待短间隔(300);
  }
  throw new Error(`天猫发票类型选择失败：点击后「${targetType}」没有变为选中状态。`);
}

async function 页面存在发票类型选错提示(page) {
  // 解决：20 位发票号码必须等类型错误提示消失后才能继续完成开票。
  const text = await 读取页面正文(page).catch(() => '');
  return /20位.*全电发票|发票类型是否选错/.test(String(text || ''));
}

async function 等待发票类型选错提示消失(page, timeoutMs = 15_000) {
  // 解决：全电类型切换后继续观察阻断提示，避免刚切换就抢先提交。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!await 页面存在发票类型选错提示(page)) {
      return true;
    }
    await 等待短间隔(300);
  }
  throw new Error('天猫发票类型选择失败：20位发票号码的全电提示仍未消失。');
}

function 格式化天猫错误文本列表(errorTexts = []) {
  // 解决：同一个红字可能被父子节点重复采集，抛错前先去重压缩。
  const 去重列表 = Array.from(new Set((Array.isArray(errorTexts) ? errorTexts : [])
    .map((text) => 标准化可见文本(text))
    .filter(Boolean)));
  const 最小红字列表 = [];
  for (const text of 去重列表.sort((left, right) => left.length - right.length)) {
    if (最小红字列表.some((shortText) => text !== shortText && text.includes(shortText))) {
      continue;
    }
    最小红字列表.push(text);
  }
  return 最小红字列表;
}

async function 读取天猫录入发票错误文本列表(page) {
  // 解决：提交前后主动读取天猫红字，避免只等抽屉关闭导致超时信息不清楚。
  const errorTexts = await page.evaluate(() => {
    const 可见 = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const 文本 = (element) => String(element.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    const 错误规则 = /请填写发票代码|发票号码需为\d+位数字|20位数字.*全电发票|发票类型是否选错|不能为空|必填|校验失败|提交失败|操作失败/;
    return Array.from(document.querySelectorAll('body *'))
      .filter(可见)
      .map(文本)
      .filter((text) => text && text.length <= 120 && 错误规则.test(text));
  }).catch(() => []);
  return 格式化天猫错误文本列表(errorTexts);
}

async function 确认天猫录入发票无错误(page, label = '天猫录入发票校验失败') {
  // 解决：点击完成开票前先让已知红字直接暴露，避免提交后才超时。
  const 错误文本列表 = await 读取天猫录入发票错误文本列表(page);
  if (错误文本列表.length > 0) {
    throw new Error(`${label}：${错误文本列表.join('；')}`);
  }
}

async function 等待天猫完成开票结果(page, orderNumber, timeoutMs = 60_000) {
  // 解决：完成开票后同时等待成功关闭抽屉或红字错误，不把明确失败拖成超时。
  const 订单号 = String(orderNumber || '').trim();
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const 错误文本列表 = await 读取天猫录入发票错误文本列表(page);
    if (错误文本列表.length > 0) {
      throw new Error(`天猫完成开票失败：${错误文本列表.join('；')}`);
    }
    const text = await 读取页面正文(page).catch(() => '');
    const 抽屉仍打开 = String(text || '').includes('录入发票信息')
      && (!订单号 || String(text || '').includes(订单号));
    if (!抽屉仍打开) {
      return true;
    }
    await 等待短间隔(1000);
  }
  throw new Error(`等待订单 ${订单号} 完成开票超时。`);
}

async function 天猫录入发票抽屉是否打开(page) {
  // 解决：批量继续下一单前先判断右侧抽屉是否还遮挡列表。
  const text = await 读取页面正文(page).catch(() => '');
  return String(text || '').includes('录入发票信息') && String(text || '').includes('完成开票');
}

async function 关闭天猫录入发票抽屉(page, timeoutMs = 8_000) {
  // 解决：单张失败后必须关闭抽屉，避免后续订单搜索按钮被遮挡。
  if (!await 天猫录入发票抽屉是否打开(page)) {
    return false;
  }
  const 关闭按钮 = page.locator('.next-drawer-close').last();
  if (await 关闭按钮.count()) {
    await 关闭按钮.click({ force: true, timeout: 5_000 }).catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!await 天猫录入发票抽屉是否打开(page)) {
      return true;
    }
    await 等待短间隔(300);
  }
  return false;
}

async function 重置天猫待回传列表页面(page) {
  // 解决：抽屉关闭失败时用重新打开列表页兜底，保证下一单从干净列表开始。
  await 关闭天猫录入发票抽屉(page).catch(() => false);
  await page.goto(天猫待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await 等待天猫待回传列表加载(page);
}

async function 选择天猫发票类型(page, order, 选项 = {}) {
  // 解决：根据识别出的发票号码和原订单发票类型选择天猫要求的发票类型。
  const 指定发票号码 = String(选项.invoiceNumber || '').trim();
  const invoiceNumber = /^\d{8,20}$/.test(指定发票号码)
    ? 指定发票号码
    : await 等待已识别发票号码(page);
  const targetType = 选择目标发票类型({ invoiceNumber, invoiceType: order.invoiceType });
  if (targetType) {
    const 标签 = await 定位天猫发票类型标签(page, targetType);
    if (!await 发票类型标签已选中(标签)) {
      await 标签.click();
      await 等待发票类型选中(page, targetType);
    }
    if (/^全电/.test(targetType)) {
      await 等待发票类型选错提示消失(page);
    }
  }
  return { invoiceNumber, targetType };
}

function 格式化截图时间(时间 = new Date()) {
  // 解决：截图文件名只使用 Windows 安全字符，避免冒号破坏文件路径。
  const pad = (value) => String(value).padStart(2, '0');
  return [
    时间.getFullYear(),
    pad(时间.getMonth() + 1),
    pad(时间.getDate()),
    '-',
    pad(时间.getHours()),
    pad(时间.getMinutes()),
    pad(时间.getSeconds()),
    '-',
    String(时间.getMilliseconds()).padStart(3, '0'),
  ].join('');
}

function 构建天猫回传截图路径(order = {}, 状态文本 = 'success') {
  // 解决：每个订单单独生成截图凭证，方便弹窗逐单打开核对。
  const 店铺标识 = 规范化店铺标识(order.storeId || order.storeName || 'tmall');
  const 订单号 = String(order.orderNumber || '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-');
  const 文件名 = `tmall-invoice-return-${店铺标识}-${订单号}-${状态文本}-${格式化截图时间()}.png`;
  return path.join(截图目录, 文件名);
}

async function 保存天猫回传截图(page, order, 状态文本) {
  // 解决：上传结果以天猫页面截图为凭证，前端通过截图接口查看。
  fs.mkdirSync(截图目录, { recursive: true });
  const 截图路径 = 构建天猫回传截图路径(order, 状态文本);
  await page.screenshot({ path: 截图路径, fullPage: true });
  return 截图路径;
}

async function 采集录入抽屉状态(page) {
  // 解决：上传后保留可审计状态，便于判断是否已经到提交前一步。
  return page.evaluate(() => {
    const 可见 = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const 短文本 = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const controls = Array.from(document.querySelectorAll('button,a,input,textarea,div[role="checkbox"],[role="button"],[role="combobox"]'))
      .filter(可见)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: 短文本(element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.value || ''),
        id: element.id || '',
        role: element.getAttribute('role') || '',
        type: element.getAttribute('type') || '',
        ariaChecked: element.getAttribute('aria-checked') || '',
        className: String(element.className || '').slice(0, 180),
      }));
    return {
      url: location.href,
      title: document.title,
      bodyTextSample: 短文本(document.body?.innerText || ''),
      controls,
      canSubmit: controls.some((item) => item.text === '完成开票'),
    };
  });
}

async function 上传单张天猫发票({ page, order, invoiceFilePath, submit = false, onAction = null } = {}) {
  // 解决：单张回传只做搜索、打开、上传和可选提交，不掺入下载逻辑。
  const 通知动作 = (message) => {
    if (typeof onAction === 'function') onAction(message);
  };
  try {
    通知动作(`正在搜索订单 ${order.orderNumber}。`);
    await 搜索天猫回传订单(page, order.orderNumber);
    通知动作(`正在打开订单 ${order.orderNumber} 的录入发票窗口。`);
    await 打开录入发票抽屉(page, order.orderNumber);
    通知动作('正在上传发票文件。');
    await 上传发票文件(page, invoiceFilePath);
    通知动作('正在等待天猫识别发票号码。');
    const invoiceNumber = await 等待已识别发票号码(page);
    通知动作('已识别发票号码，正在选择发票类型。');
    const typeResult = await 选择天猫发票类型(page, order, { invoiceNumber });
    const drawerState = await 采集录入抽屉状态(page);
    let screenshotPath = '';
    if (submit) {
      通知动作('正在检查完成开票前页面错误。');
      await 确认天猫录入发票无错误(page, '天猫完成开票前校验失败');
      通知动作('正在点击完成开票。');
      await page.locator('button').filter({ hasText: /^完成开票$/ }).last().click();
      通知动作('正在等待天猫确认完成开票结果。');
      await 等待天猫完成开票结果(page, order.orderNumber);
      通知动作('正在保存回传截图凭证。');
      screenshotPath = await 保存天猫回传截图(page, order, 'success');
    }
    return {
      ...typeResult,
      drawerState,
      screenshotPath,
      submitted: submit === true,
    };
  } catch (错误) {
    const screenshotPath = await 保存天猫回传截图(page, order, 'error').catch(() => '');
    错误.screenshotPath = screenshotPath;
    throw 错误;
  }
}

module.exports = {
  天猫待回传发票页面地址,
  发票类型列表,
  滑块验证特征列表,
  滑块组件选择器,
  是天猫待回传列表文本,
  读取天猫待回传页面状态,
  等待天猫待回传列表或登录页,
  检测滑块验证,
  提取行内发票类型,
  提取行内发票金额,
  提取行内发票抬头,
  提取行内申请时间,
  提取行内赔付倒计时,
  提取行内批准状态,
  解析天猫列表日期时间,
  计算已过工作日数,
  计算第几个工作日日期,
  格式化天猫参考日期,
  构建天猫财务开票参考,
  打开天猫待回传发票页面,
  等待天猫待回传列表加载,
  读取当前页待回传订单,
  读取当前页发票订单状态摘要,
  构建天猫无可回传订单错误消息,
  导出天猫待回传订单,
  转换天猫导出下载错误,
  等待天猫导出下载,
  确认天猫批量导出按钮可用,
  搜索天猫回传订单,
  打开录入发票抽屉,
  上传发票文件,
  读取输入框值,
  读取已识别发票号码,
  等待已识别发票号码,
  选择目标发票类型,
  定位天猫发票类型标签,
  发票类型标签已选中,
  等待发票类型选中,
  页面存在发票类型选错提示,
  读取天猫录入发票错误文本列表,
  确认天猫录入发票无错误,
  等待天猫完成开票结果,
  天猫录入发票抽屉是否打开,
  关闭天猫录入发票抽屉,
  重置天猫待回传列表页面,
  选择天猫发票类型,
  格式化截图时间,
  构建天猫回传截图路径,
  保存天猫回传截图,
  采集录入抽屉状态,
  上传单张天猫发票,
};
