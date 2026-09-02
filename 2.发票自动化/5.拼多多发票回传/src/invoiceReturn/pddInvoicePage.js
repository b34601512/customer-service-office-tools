const fs = require('fs');
const path = require('path');
const { 等待拼多多登录完成, 是拼多多登录页面 } = require('../browser/pddAuthenticatedPage');
const { 打印日志 } = require('../common/logger');
const { 截图目录, 规范化店铺标识 } = require('../common/paths');

const 拼多多待回传发票页面地址 = 'https://mms.pinduoduo.com/invoice/center?quickFilterValue=';
const 拼多多导出记录页面地址 = 'https://mms.pinduoduo.com/invoice/center/history';
const 滑块验证特征列表 = ['拖动滑块', '滑动验证', '请完成验证', '安全验证', '向右拖动'];
const 滑块组件选择器 = '#nc_1_wrapper, .nc_wrapper, [class*="nc_iconfont"], [id*="nc_"]';
const 滑块等待总上限毫秒 = 10 * 60_000;

function 等待短间隔(ms) {
  // 解决：第三方页面加载状态不稳定，轮询时只做短暂停顿。
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function 读取页面正文(page) {
  // 解决：所有页面状态判断统一读取正文，避免每个动作散落不同规则。
  return page.locator('body').innerText({ timeout: 15_000 });
}

async function 等待页面状态(page, label, timeoutMs, predicate) {
  // 解决：拼多多后台加载速度不固定，按真实状态等，不按固定秒数猜。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = await 读取页面正文(page).catch(() => '');
    if (predicate(text)) return text;
    await 等待短间隔(1000);
  }
  throw new Error(`${label}超时。`);
}

function 是拼多多待开票列表文本(text) {
  // 解决：列表就绪必须同时出现订单开票主界面和批量导出入口。
  const 正文 = String(text || '');
  return 正文.includes('订单开票') && 正文.includes('批量导出') && (正文.includes('录入发票') || /暂无数据|没有数据|无数据|共有\s*0\s*条/.test(正文));
}

function 读取拼多多待开票页面状态(url, text) {
  // 解决：业务页面被登录页拦截时立即进入登录等待，不白等列表超时。
  if (是拼多多登录页面(url)) {
    return 'login';
  }
  if (是拼多多待开票列表文本(text)) {
    return 'ready';
  }
  return 'loading';
}

async function 关闭拼多多逾期提醒弹窗(page) {
  // 解决：逾期开票提醒会遮挡批量导出，进入页面后先关掉它。
  const text = await 读取页面正文(page).catch(() => '');
  if (!String(text || '').includes('订单开票即将逾期')) {
    return false;
  }
  const closeButton = page.locator('[data-testid="beast-core-modal-icon-close"]').last();
  if (await closeButton.count()) {
    await closeButton.click({ timeout: 5000 }).catch(() => {});
    await 等待短间隔(500);
    return true;
  }
  await page.keyboard.press('Escape').catch(() => {});
  await 等待短间隔(500);
  return true;
}

async function 关闭拼多多非业务浮层(page) {
  // 解决：拼多多广告/营销/引导等非订单浮层（含全屏遮罩）会拦截业务按钮，关键点击前统一清理。
  await page.keyboard.press('Escape').catch(() => {});
  return page.evaluate(() => {
    const 处理结果列表 = [];
    const 读取文本 = (element) => String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
    const 可见 = (element) => {
      if (!element || element === document.body) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const 是业务弹窗 = (text) => /录入发票|发票号码|批量导出发票明细|订单开票即将逾期/.test(text);
    // 解决：广告/营销/引导类浮层文案多样，用较宽的促销关键词兜底，业务弹窗仍受白名单保护不被关闭。
    const 是广告或非业务浮层 = (text) => /优惠特权|立即开启|服务费直降|专属福利|安全托管|高性价比|高效经营|限时|秒杀|新人|专享|招商|补贴|成长|福利|活动|领取|礼包|扶持|爆单|智能托管|会员|权益|开通|体验|引导|公告|通知|我知道了|稍后|暂不/.test(text);
    const 是遮罩 = (element) => {
      const className = String(element.className || '');
      const testid = String(element.getAttribute?.('data-testid') || '');
      return /mask|overlay|遮罩/i.test(`${className} ${testid}`)
        || element.getAttribute?.('aria-modal') === 'true';
    };
    const 查找关闭按钮 = (container) => Array.from(
      container.querySelectorAll('button,[role="button"],[aria-label],i,span,a,div,[data-testid*="close" i],[data-testid*="Close" i],.beast-core-modal-icon-close'),
    ).filter(可见).find((element) => {
      const text = 读取文本(element);
      const aria = String(element.getAttribute('aria-label') || '').trim();
      const testid = String(element.getAttribute('data-testid') || '').trim();
      const className = String(element.className || '');
      return text === '×'
        || text === 'x'
        || text === 'X'
        || text === '关闭'
        || text === '暂不'
        || text === '稍后再说'
        || text === '以后再说'
        || text === '我知道了'
        || aria.includes('关闭')
        || /close|icon-close|modal-close|mask-close/i.test(`${className} ${testid}`);
    });
    const 禁用指针事件 = (element) => {
      let current = element;
      let count = 0;
      while (current && current !== document.body && count < 4) {
        current.setAttribute('data-pdd-invoice-overlay-disabled', '1');
        current.style.pointerEvents = 'none';
        current = current.parentElement;
        count += 1;
      }
    };
    // 解决：先处理所有模态/抽屉/浮层容器，命中关闭按钮则点击，否则禁用指针事件让业务 DOM 点击穿透。
    const 浮层选择器 = '[role="dialog"],[role="alertdialog"],.beast-core-modal,.beast-modal,[class*="modal"],[class*="popup"],[class*="drawer"],[class*="overlay"],[class*="dialog"],[class*="banner"],[class*="notice"],[class*="guide"]';
    for (const element of Array.from(document.querySelectorAll(浮层选择器))) {
      if (!可见(element)) continue;
      const text = 读取文本(element);
      if (是业务弹窗(text)) continue;
      if (!是广告或非业务浮层(text) && !是遮罩(element)) continue;
      const closeButton = 查找关闭按钮(element);
      if (closeButton) {
        closeButton.click();
        处理结果列表.push({ selector: 'marketing-modal-close', text: text.slice(0, 120) });
        continue;
      }
      禁用指针事件(element);
      处理结果列表.push({ selector: 'marketing-modal-disable', text: text.slice(0, 120) });
    }
    // 解决：独立存在的全屏遮罩（无文案、单纯拦截点击）单独禁用，避免关掉弹窗但遮罩残留挡住业务按钮。
    const 业务弹窗已打开 = Array.from(document.querySelectorAll('[role="dialog"],.beast-core-modal,.beast-modal,[class*="modal"]'))
      .some((element) => 可见(element) && 是业务弹窗(读取文本(element)));
    if (!业务弹窗已打开) {
      for (const mask of Array.from(document.querySelectorAll('[class*="mask"],[class*="overlay"],[class*="Mask"],[class*="Overlay"],.beast-core-mask'))) {
        if (!可见(mask)) continue;
        const rect = mask.getBoundingClientRect();
        const 接近全屏 = rect.width >= (window.innerWidth || 0) * 0.6 && rect.height >= (window.innerHeight || 0) * 0.6;
        if (!接近全屏) continue;
        if (是业务弹窗(读取文本(mask))) continue;
        if (mask.hasAttribute('data-pdd-invoice-overlay-disabled')) continue;
        mask.setAttribute('data-pdd-invoice-overlay-disabled', '1');
        mask.style.pointerEvents = 'none';
        处理结果列表.push({ selector: 'mask-disable', text: 读取文本(mask).slice(0, 120) });
      }
    }
    // 解决：已知首页悬浮入口（消息中心/站内信）直接禁用指针事件，不依赖文案匹配。
    const 悬浮入口 = document.querySelector('#umd_kits_home_entry');
    if (悬浮入口 && 可见(悬浮入口)) {
      悬浮入口.setAttribute('data-pdd-invoice-overlay-disabled', '1');
      悬浮入口.style.pointerEvents = 'none';
      处理结果列表.push({ selector: '#umd_kits_home_entry', text: 读取文本(悬浮入口).slice(0, 120) });
    }
    return 处理结果列表;
  }).catch(() => []);
}

async function 检测拼多多滑块验证(page) {
  // 解决：滑块未完成时列表数据接口不返回数据，必须停下等人工完成。
  try {
    const text = await 读取页面正文(page).catch(() => '');
    if (滑块验证特征列表.some((特征) => text.includes(特征))) return true;
    const count = await page.locator(滑块组件选择器).count().catch(() => 0);
    return count > 0;
  } catch { return false; }
}

async function 等待拼多多待开票列表或登录页(page, timeoutMs = 120_000) {
  // 解决：同时等待待开票列表和登录页，避免未登录时误判为页面加载慢。
  let startedAt = Date.now();
  let 滑块首次出现时间 = 0;
  let 已提示滑块 = false;
  while (Date.now() - startedAt < timeoutMs) {
    await 关闭拼多多逾期提醒弹窗(page);
    await 关闭拼多多非业务浮层(page);
    const text = await 读取页面正文(page).catch(() => '');
    const 有滑块 = await 检测拼多多滑块验证(page);
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
        打印日志('拼多多登录', '滑块验证', '检测到滑动验证，程序已暂停自动操作，请在弹出的窗口完成滑块，完成后自动继续');
      }
      await page.bringToFront().catch(() => {});
      await 等待短间隔(1000);
      continue;
    }
    const state = 读取拼多多待开票页面状态(page.url(), text);
    if (state === 'ready' || state === 'login') {
      return { state, text, url: page.url() };
    }
    await 等待短间隔(1000);
  }
  throw new Error('等待拼多多待开票列表加载超时。');
}

async function 等待拼多多待开票列表加载(page) {
  // 解决：DOM 加载完成不代表列表接口完成，必须等业务文本出现。
  const result = await 等待拼多多待开票列表或登录页(page);
  if (result.state === 'login') {
    throw new Error(`拼多多待开票页面需要登录：${result.url}`);
  }
  return result.text;
}

async function 打开拼多多待回传发票页面(page, 店铺配置 = {}, 选项 = {}) {
  // 解决：所有回传动作都从订单开票页进入，避免依赖首页跳转残留状态。
  const { 登录等待超时毫秒 = 15 * 60_000 } = 选项;
  await page.goto(拼多多待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.bringToFront().catch(() => {});
  const 首次状态 = await 等待拼多多待开票列表或登录页(page);
  if (首次状态.state === 'ready') {
    return 首次状态.text;
  }
  await 等待拼多多登录完成(page, 店铺配置, { timeoutMs: 登录等待超时毫秒 });
  await page.goto(拼多多待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  return 等待拼多多待开票列表加载(page);
}

function 生成导出文件名(suggestedFilename) {
  // 解决：下载文件名可能重复，保存时加时间戳方便追溯。
  const safeName = String(suggestedFilename || 'pdd_invoice_export.csv').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_');
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeName}`;
}

async function 元素是否禁用(locator) {
  // 解决：拼多多按钮可能只用 disabled class 表示禁用，不能只看 disabled 属性。
  if (!await locator.isEnabled().catch(() => false)) return true;
  return locator.evaluate((element) => {
    const className = String(element.className || '');
    return element.disabled === true || element.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/i.test(className);
  }).catch(() => false);
}

async function 触发拼多多按钮DOM点击(locator, 动作名称 = '按钮') {
  // 解决：已定位到目标按钮后直接触发 DOM click，绕开消息浮层对鼠标坐标的拦截。
  try {
    await locator.evaluate((element) => {
      if (typeof element.click === 'function') {
        element.click();
        return;
      }
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
  } catch (错误) {
    throw new Error(`触发拼多多${动作名称}失败：${错误.message}`);
  }
}

function 读取拼多多行内操作状态(rowText) {
  const text = String(rowText || '');
  if (text.includes('录入发票')) return '可录入发票';
  if (text.includes('同意')) return '待同意';
  if (text.includes('详情')) return '仅详情';
  if (text.includes('已开票')) return '已开票';
  return '待处理';
}

async function 读取当前页待回传订单(page, 店铺配置 = {}) {
  // 解决：同步与回传都读取待开票列表的全部订单，不再只看操作列含“录入发票”的行；
  // 发票是否已开好由下载中心逐单判断（没有可下载发票时跳过）。
  const rows = await page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return Array.from(document.querySelectorAll('tr, [role="row"]'))
      .filter(visible)
      .map((element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => /\b\d{6,}-\d{10,}\b/.test(text));
  });
  const 已存在订单号 = new Set();
  return rows.map((rowText) => {
    const orderNumber = rowText.match(/\b\d{6,}-\d{10,}\b/)?.[0] || '';
    const operationStatus = 读取拼多多行内操作状态(rowText);
    return {
      key: `${店铺配置.id || 'pdd'}:${orderNumber}`,
      storeId: 店铺配置.id || '',
      storeName: 店铺配置.name || '',
      orderNumber,
      operationStatus,
      rowText,
    };
  }).filter((order) => {
    if (!order.orderNumber || 已存在订单号.has(order.orderNumber)) return false;
    已存在订单号.add(order.orderNumber);
    return true;
  });
}

async function 确认拼多多批量导出按钮可用(page) {
  // 解决：批量导出按钮禁用时抛出业务原因，不把 Playwright 重试日志给用户。
  const 批量导出按钮 = page.locator('button').filter({ hasText: /^批量导出$/ }).first();
  await 批量导出按钮.waitFor({ state: 'visible', timeout: 15_000 });
  if (!await 元素是否禁用(批量导出按钮)) {
    return 批量导出按钮;
  }
  const 当前页订单 = await 读取当前页待回传订单(page, { id: 'pdd', name: '拼多多店铺' }).catch(() => []);
  if (当前页订单.length === 0) {
    throw new Error('拼多多批量导出不可用：当前店铺没有待开票订单。');
  }
  throw new Error(`拼多多批量导出不可用：页面已有 ${当前页订单.length} 单待开票订单，但批量导出按钮仍是禁用状态，请刷新页面后重试。`);
}

async function 触发拼多多导出报表(page, 选项 = {}) {
  // 解决：拼多多批量导出先生成报表，不会直接触发浏览器下载。
  const { onAction = null } = 选项;
  const 通知动作 = (message) => {
    if (typeof onAction === 'function') onAction(message);
  };
  await 等待拼多多待开票列表加载(page);
  const 批量导出按钮 = await 确认拼多多批量导出按钮可用(page);
  通知动作('正在点击拼多多批量导出。');
  await 关闭拼多多非业务浮层(page);
  await 触发拼多多按钮DOM点击(批量导出按钮, '批量导出');
  通知动作('正在等待拼多多导出确认弹窗。');
  await 等待页面状态(page, '等待拼多多导出确认弹窗', 30_000, (text) => String(text || '').includes('批量导出发票明细'));
  通知动作('正在生成拼多多导出报表。');
  await 关闭拼多多非业务浮层(page);
  await 触发拼多多按钮DOM点击(page.locator('button').filter({ hasText: /^生成报表$/ }).last(), '生成报表');
  await 等待短间隔(1500);
}

function 转换拼多多导出下载错误(错误) {
  // 解决：下载事件失败时转成用户能判断的拼多多导出原因。
  const message = String(错误?.message || 错误 || '').trim();
  if (/Target page, context or browser has been closed/i.test(message)) {
    return new Error('拼多多批量导出失败：等待下载文件时页面或浏览器被关闭。');
  }
  if (/Timeout/i.test(message)) {
    return new Error('拼多多批量导出失败：等待下载报表超时，可能是报表还没生成或登录状态失效。');
  }
  return new Error(`拼多多批量导出失败：等待下载报表失败。${message}`);
}

async function 等待拼多多导出下载(downloadPromise) {
  // 解决：集中等待下载事件，失败时抛出明确中文错误。
  try {
    return await downloadPromise;
  } catch (错误) {
    throw 转换拼多多导出下载错误(错误);
  }
}

async function 打开拼多多导出记录页(page) {
  // 解决：报表生成后直接进入导出记录页下载，避免依赖更多菜单弹层状态。
  await page.goto(拼多多导出记录页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await 等待页面状态(page, '等待拼多多导出记录页', 60_000, (text) => String(text || '').includes('订单开票') && String(text || '').includes('报表'));
}

async function 等待并点击拼多多下载报表(page, timeoutMs = 180_000) {
  // 解决：报表可能需要生成时间，按下载按钮可用状态轮询。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await 关闭拼多多非业务浮层(page);
    const 下载按钮 = page.locator('button, a').filter({ hasText: /^下载报表$/ }).first();
    if (await 下载按钮.count() && !await 元素是否禁用(下载按钮)) {
      const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
      downloadPromise.catch(() => {});
      await 关闭拼多多非业务浮层(page);
      await 触发拼多多按钮DOM点击(下载按钮, '下载报表');
      return 等待拼多多导出下载(downloadPromise);
    }
    const 刷新按钮 = page.locator('button').filter({ hasText: /^刷新$/ }).first();
    if (await 刷新按钮.count() && !await 元素是否禁用(刷新按钮)) {
      // 解决：刷新是真实坐标点击，广告遮罩可能拦截，点击前再清一次浮层。
      await 关闭拼多多非业务浮层(page);
      await 刷新按钮.click().catch(() => {});
    }
    await 等待短间隔(3000);
  }
  throw new Error('拼多多批量导出失败：导出记录页没有等到可下载报表。');
}

async function 下载最新拼多多导出报表(page, outputDirectory, 选项 = {}) {
  // 解决：从导出记录页下载最新报表，并落盘到本项目运行目录。
  const { onAction = null } = 选项;
  const 通知动作 = (message) => {
    if (typeof onAction === 'function') onAction(message);
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  通知动作('正在打开拼多多导出记录页。');
  await 打开拼多多导出记录页(page);
  通知动作('正在等待拼多多报表生成。');
  const download = await 等待并点击拼多多下载报表(page);
  const exportFilePath = path.join(outputDirectory, 生成导出文件名(download.suggestedFilename()));
  通知动作('正在保存拼多多导出报表。');
  await download.saveAs(exportFilePath);
  const failure = await download.failure();
  if (failure) throw new Error(`拼多多批量导出失败：${failure}`);
  return exportFilePath;
}

async function 导出拼多多待回传订单(page, outputDirectory, 选项 = {}) {
  // 解决：完整执行生成报表和下载报表，后续订单字段只解析导出文件。
  const { onAction = null } = 选项;
  await 关闭拼多多逾期提醒弹窗(page);
  await 触发拼多多导出报表(page, { onAction });
  return 下载最新拼多多导出报表(page, outputDirectory, { onAction });
}

function 去除UTF8BOM(text) {
  // 解决：导出的 CSV 可能带 BOM，表头匹配前必须移除。
  return String(text || '').replace(/^\uFEFF/, '');
}

function 解析CSV文本(text) {
  // 解决：用最小 CSV 解析器处理逗号和引号，不引入额外依赖。
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;
  const source = 去除UTF8BOM(text);
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1;
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }
    currentCell += char;
  }
  if (currentCell || currentRow.length) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }
  return rows.filter((row) => row.some((cell) => String(cell || '').trim()));
}

function 将CSV行转换为对象列表(rows) {
  // 解决：导出文件后续按表头读字段，避免靠固定列号猜。
  const [headers = [], ...dataRows] = rows;
  return dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [
    String(header || '').trim(),
    String(row[index] || '').trim(),
  ])));
}

function 清理拼多多导出占位值(value) {
  // 解决：拼多多导出用短横线表示空值，业务字段里统一转为空。
  const text = String(value || '').trim();
  return text === '-' ? '' : text;
}

function 读取拼多多订单发票类型(row = {}) {
  // 解决：不同页面显示“电票/蓝票”，导出文件优先取完整发票类型。
  return 清理拼多多导出占位值(row['发票类型'] || row['发票种类'] || '');
}

function 解析拼多多导出日期时间(value) {
  // 解决：拼多多导出时间要参与财务开票参考，先统一解析成 Date。
  const text = 清理拼多多导出占位值(value);
  if (!text) return null;
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) return null;
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function 是否自然周工作日(date) {
  // 解决：财务参考只做周一到周五的粗略估算，不掺入节假日兜底逻辑。
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function 复制日期到当天零点(date) {
  // 解决：工作日计算只比较日期，不被时分秒影响。
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function 计算已过工作日数(startDate, endDate) {
  // 解决：展示申请后已经等了几个工作日，方便判断是否还在正常财务周期。
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
  // 解决：给用户一个大概财务完成日期，避免只能看原始申请时间。
  const cursor = 复制日期到当天零点(startDate);
  let count = 0;
  while (count < workdayCount) {
    cursor.setDate(cursor.getDate() + 1);
    if (是否自然周工作日(cursor)) count += 1;
  }
  return cursor;
}

function 格式化拼多多日期(date) {
  // 解决：财务参考日期只展示到天，减少弹窗信息噪声。
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function 构建拼多多财务开票参考(invoiceApplyTime, now = new Date()) {
  // 解决：把“财务约 7 个工作日开票”的经验固定显示到订单行里。
  const applyDate = 解析拼多多导出日期时间(invoiceApplyTime);
  if (!applyDate) return invoiceApplyTime ? '财务参考：申请时间格式未识别' : '财务参考：未获取申请时间';
  const elapsedWorkdays = 计算已过工作日数(applyDate, now);
  if (elapsedWorkdays >= 7) {
    return `财务参考：已过 ${elapsedWorkdays} 个工作日，超过常规 7 个工作日`;
  }
  const estimatedDate = 计算第几个工作日日期(applyDate, 7);
  return `财务参考：已过 ${elapsedWorkdays} 个工作日，常规约 7 个工作日，预计 ${格式化拼多多日期(estimatedDate)} 前后`;
}

function 转换拼多多导出订单(row = {}, 店铺配置 = {}) {
  // 解决：把拼多多 CSV 行转换成回传流程稳定订单对象。
  const orderNumber = 清理拼多多导出占位值(row['订单号']);
  const invoiceApplyTime = 清理拼多多导出占位值(row['申请时间']);
  return {
    key: `${店铺配置.id}:${orderNumber}`,
    storeId: 店铺配置.id,
    storeName: 店铺配置.name,
    orderNumber,
    invoiceAmount: 清理拼多多导出占位值(row['发票金额']),
    invoiceType: 读取拼多多订单发票类型(row),
    invoiceApplyTime,
    promisedInvoiceTime: 清理拼多多导出占位值(row['承诺开票时间']),
    financeIssueReference: 构建拼多多财务开票参考(invoiceApplyTime),
    invoiceTitleType: 清理拼多多导出占位值(row['抬头类型']),
    invoiceTitle: 清理拼多多导出占位值(row['发票抬头']),
    buyerTaxNumber: 清理拼多多导出占位值(row['企业税号']),
    orderStatus: 清理拼多多导出占位值(row['订单状态']),
    afterSaleStatus: 清理拼多多导出占位值(row['售后状态']),
    raw: row,
  };
}

function 读取拼多多导出订单(exportFilePath, 店铺配置 = {}) {
  // 解决：批量导出报表是订单字段来源，解析后供下载和上传复用。
  const text = fs.readFileSync(exportFilePath, 'utf8');
  const rows = 解析CSV文本(text);
  const objects = 将CSV行转换为对象列表(rows);
  const 已存在订单号 = new Set();
  return objects.map((row) => 转换拼多多导出订单(row, 店铺配置))
    .filter((order) => {
      if (!order.orderNumber || 已存在订单号.has(order.orderNumber)) return false;
      已存在订单号.add(order.orderNumber);
      return true;
    });
}

async function 搜索拼多多回传订单(page, orderNumber) {
  // 解决：上传前按订单号过滤列表，避免点错其它订单的录入发票。
  const 订单号 = String(orderNumber || '').trim();
  if (!订单号) throw new Error('搜索拼多多回传订单失败：订单号为空。');
  await page.goto(拼多多待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await 等待拼多多待开票列表加载(page);
  await 关闭拼多多非业务浮层(page);
  await page.locator('input[placeholder="请输入订单编号"]').first().fill(订单号);
  await 关闭拼多多非业务浮层(page);
  await 触发拼多多按钮DOM点击(page.locator('button').filter({ hasText: /^查询$/ }).first(), '查询');
  await 等待页面状态(page, `等待拼多多订单 ${订单号} 搜索结果`, 60_000, (text) => String(text || '').includes(订单号) && String(text || '').includes('录入发票'));
}

async function 打开拼多多录入发票弹窗(page, orderNumber) {
  // 解决：只在目标订单所在行点击录入发票，避免多个同名操作混淆。
  const 订单号 = String(orderNumber || '').trim();
  await 关闭拼多多非业务浮层(page);
  const row = page.locator('tr, [role="row"]').filter({ hasText: 订单号 }).first();
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await 关闭拼多多非业务浮层(page);
  await 触发拼多多按钮DOM点击(row.locator('text=录入发票').last(), '录入发票');
  await 等待页面状态(page, '等待拼多多录入发票弹窗打开', 30_000, (text) => {
    const 正文 = String(text || '');
    return 正文.includes('录入发票') && 正文.includes(订单号) && 正文.includes('发票号码');
  });
}

function 定位拼多多录入发票弹窗(page) {
  // 解决：上传和填写都限制在录入发票弹窗内，不误操作页面筛选输入框。
  return page.locator('[role="dialog"]').filter({ hasText: '录入发票' }).last();
}

async function 定位拼多多发票文件输入框(page) {
  // 解决：拼多多部分页面版本没有给业务弹窗保留 role="dialog"，不能把上传依赖在该语义属性上。
  const dialog = 定位拼多多录入发票弹窗(page);
  if (await dialog.count()) {
    const dialogFileInput = dialog.locator('input[type="file"][data-testid="beast-core-upload-input"]');
    if (await dialogFileInput.count()) return dialogFileInput.last();
  }
  const pageFileInput = page.locator('input[type="file"][data-testid="beast-core-upload-input"]');
  if (await pageFileInput.count()) return pageFileInput.last();
  throw new Error('上传拼多多发票失败：未找到发票文件上传控件。');
}

async function 定位拼多多发票字段输入框(page, selector) {
  // 解决：部分页面版本没有 role="dialog"，输入框也不能强依赖弹窗语义属性。
  const dialog = 定位拼多多录入发票弹窗(page);
  if (await dialog.count()) {
    const dialogInput = dialog.locator(selector);
    if (await dialogInput.count()) return dialogInput.first();
  }
  const pageInput = page.locator(selector);
  if (await pageInput.count()) return pageInput.last();
  throw new Error('填写拼多多发票信息失败：未找到对应输入框。');
}

async function 上传拼多多发票文件(page, invoiceFilePath) {
  // 解决：直接设置真实文件 input，不模拟人工选择文件。
  if (!fs.existsSync(invoiceFilePath)) {
    throw new Error(`上传拼多多发票失败：文件不存在 ${invoiceFilePath}`);
  }
  const fileInput = await 定位拼多多发票文件输入框(page);
  await fileInput.setInputFiles(invoiceFilePath);
  const fileName = path.basename(invoiceFilePath);
  await 等待页面状态(page, '等待拼多多发票文件上传完成', 180_000, (text) => String(text || '').includes(fileName) || String(text || '').includes('预览'));
}

async function 填写拼多多发票号码(page, invoiceNumber) {
  // 解决：拼多多不会从文件自动 OCR 发票号码，必须使用下载中心返回的号码。
  const 发票号码 = String(invoiceNumber || '').trim();
  if (!/^\d{8,20}$/.test(发票号码)) {
    throw new Error(`填写拼多多发票号码失败：发票号码必须是 8 到 20 位数字，当前值=${发票号码 || '空'}`);
  }
  const invoiceNumberInput = await 定位拼多多发票字段输入框(page, 'input[placeholder="请输入"]');
  await invoiceNumberInput.fill(发票号码);
}

async function 填写拼多多发票代码(page, invoiceCode = '') {
  // 解决：发票代码是可选字段，有值才填写，没有就保持为空。
  const 发票代码 = String(invoiceCode || '').trim();
  if (!发票代码) return false;
  const invoiceCodeInput = await 定位拼多多发票字段输入框(page, 'input[placeholder="如果开具的发票无“发票代码”，可不填写"]');
  await invoiceCodeInput.fill(发票代码);
  return true;
}

function 标准化可见文本(text) {
  // 解决：错误提示里换行和多空格会影响去重，统一压成一行。
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function 格式化拼多多错误文本列表(errorTexts = []) {
  // 解决：同一错误可能被父子节点重复采集，抛错前先去重压缩。
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

async function 读取拼多多录入发票错误文本列表(page) {
  // 解决：提交前后主动读取红字，避免明确失败被拖成超时。
  const errorTexts = await page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const text = (element) => String(element.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    const errorRule = /请完善信息|请填写|发票号码需为|上传的发票|发票抬头|校验失败|提交失败|操作失败|不能为空|必填|不一致|失败/;
    return Array.from(document.querySelectorAll('body *'))
      .filter(visible)
      .map((element) => ({
        element,
        value: text(element),
        tagName: String(element.tagName || '').toUpperCase(),
      }))
      .filter(({ element, value, tagName }) => {
        // 解决：页面底部“开票失败”筛选标签和弹窗“发票抬头”字段名不能当成错误。
        if (value === '发票抬头') return false;
        if (value === '开票失败' && ['BUTTON', 'A'].includes(tagName)) return false;
        const className = String(element.className || '').toLowerCase();
        return className.includes('error') || className.includes('danger') || /请完善信息|请填写|发票号码需为|上传的发票|校验失败|提交失败|操作失败|不能为空|必填|不一致/.test(value);
      })
      .map(({ value }) => value)
      .filter((item) => item && item.length <= 160 && errorRule.test(item));
  }).catch(() => []);
  return 格式化拼多多错误文本列表(errorTexts);
}

async function 确认拼多多录入发票无错误(page, label = '拼多多录入发票校验失败') {
  // 解决：明确红字直接抛出，让用户知道真实失败原因。
  const 错误文本列表 = await 读取拼多多录入发票错误文本列表(page);
  if (错误文本列表.length > 0) {
    throw new Error(`${label}：${错误文本列表.join('；')}`);
  }
}

async function 等待拼多多确认回传按钮可用(page, timeoutMs = 180_000) {
  // 解决：上传完成后拼多多还会异步校验文件，确认按钮要等到真正可用。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const 确认按钮 = page.locator('[data-testid="beast-core-modal-ok-button"]:visible');
    const 按钮数量 = await 确认按钮.count();
    if (按钮数量 === 1 && !await 元素是否禁用(确认按钮.first())) {
      return 确认按钮.first();
    }
    await 确认拼多多录入发票无错误(page, '拼多多确认前校验失败');
    await 等待短间隔(1000);
  }
  throw new Error('触发拼多多确认回传失败：确认按钮在文件校验完成前一直不可用。');
}

async function 点击拼多多确认回传按钮(page) {
  // 解决：确认动作只点击已通过状态检查的唯一可见业务按钮。
  const 确认按钮 = await 等待拼多多确认回传按钮可用(page);
  await 确认按钮.click({ force: true });
}

async function 等待拼多多确认回传结果(page, orderNumber, timeoutMs = 60_000) {
  // 解决：确认后同时等待弹窗关闭和红字错误，不把失败拖成超时。
  const 订单号 = String(orderNumber || '').trim();
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const 错误文本列表 = await 读取拼多多录入发票错误文本列表(page);
    if (错误文本列表.length > 0) {
      throw new Error(`拼多多确认回传失败：${错误文本列表.join('；')}`);
    }
    const 弹窗仍打开 = await 拼多多录入发票弹窗是否打开(page);
    if (!弹窗仍打开) {
      return true;
    }
    await 等待短间隔(1000);
  }
  throw new Error(`等待拼多多订单 ${订单号} 确认回传超时。`);
}

async function 拼多多录入发票弹窗是否打开(page) {
  // 解决：页面背景也可能包含“录入发票”和订单号，不能用整页文本判断弹窗是否仍打开。
  const invoiceNumberInput = page.locator('input[placeholder="请输入"]');
  const inputCount = await invoiceNumberInput.count().catch(() => 0);
  if (!inputCount) return false;
  return invoiceNumberInput.first().isVisible().catch(() => false);
}

async function 关闭拼多多录入发票弹窗(page, timeoutMs = 8000) {
  // 解决：单张失败后关闭弹窗，保证下一单从干净列表开始。
  if (!await 拼多多录入发票弹窗是否打开(page)) {
    return false;
  }
  const 取消按钮 = page.locator('[data-testid="beast-core-modal-close-button"]').last();
  if (await 取消按钮.count()) {
    // 解决：关闭录入弹窗前先清掉可能压在上面的广告浮层，避免坐标点击被拦截。
    await 关闭拼多多非业务浮层(page);
    await 取消按钮.click({ timeout: 5000 }).catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!await 拼多多录入发票弹窗是否打开(page)) {
      return true;
    }
    await 等待短间隔(300);
  }
  return false;
}

async function 重置拼多多待回传列表页面(page) {
  // 解决：失败后回到订单开票页，避免历史页或弹窗状态污染下一单。
  await 关闭拼多多录入发票弹窗(page).catch(() => false);
  await page.goto(拼多多待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await 等待拼多多待开票列表加载(page);
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

function 构建拼多多回传截图路径(order = {}, 状态文本 = 'success') {
  // 解决：每个订单单独生成截图凭证，方便弹窗逐单打开核对。
  const 店铺标识 = 规范化店铺标识(order.storeId || order.storeName || 'pdd');
  const 订单号 = String(order.orderNumber || '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-');
  const 文件名 = `pdd-invoice-return-${店铺标识}-${订单号}-${状态文本}-${格式化截图时间()}.png`;
  return path.join(截图目录, 文件名);
}

async function 保存拼多多回传截图(page, order, 状态文本) {
  // 解决：上传结果以拼多多页面截图为凭证，前端通过截图接口查看。
  fs.mkdirSync(截图目录, { recursive: true });
  const 截图路径 = 构建拼多多回传截图路径(order, 状态文本);
  await page.screenshot({ path: 截图路径, fullPage: true });
  return 截图路径;
}

async function 上传单张拼多多发票({ page, order, invoiceFilePath, invoiceNumber = '', invoiceCode = '', submit = false, onAction = null } = {}) {
  // 解决：单张回传只做搜索、打开、上传、填号和可选确认，不掺入下载逻辑。
  const 通知动作 = (message) => {
    if (typeof onAction === 'function') onAction(message);
  };
  const 发票号码 = String(invoiceNumber || order?.invoiceNumber || '').trim();
  const 发票代码 = String(invoiceCode || order?.invoiceCode || '').trim();
  try {
    通知动作(`正在搜索拼多多订单 ${order.orderNumber}。`);
    await 搜索拼多多回传订单(page, order.orderNumber);
    通知动作(`正在打开拼多多订单 ${order.orderNumber} 的录入发票弹窗。`);
    await 打开拼多多录入发票弹窗(page, order.orderNumber);
    通知动作('正在上传拼多多发票文件。');
    await 上传拼多多发票文件(page, invoiceFilePath);
    通知动作('正在填写拼多多发票号码。');
    await 填写拼多多发票号码(page, 发票号码);
    if (发票代码) {
      通知动作('正在填写拼多多发票代码。');
      await 填写拼多多发票代码(page, 发票代码);
    }
    通知动作('正在检查拼多多录入信息。');
    await 确认拼多多录入发票无错误(page, '拼多多确认前校验失败');
    let screenshotPath = '';
    if (submit) {
      通知动作('正在确认拼多多发票回传。');
      await 点击拼多多确认回传按钮(page);
      通知动作('正在等待拼多多确认回传结果。');
      await 等待拼多多确认回传结果(page, order.orderNumber);
      通知动作('正在保存拼多多回传截图凭证。');
      screenshotPath = await 保存拼多多回传截图(page, order, 'success');
    }
    return {
      invoiceNumber: 发票号码,
      invoiceCode: 发票代码,
      screenshotPath,
      submitted: submit === true,
    };
  } catch (错误) {
    const screenshotPath = await 保存拼多多回传截图(page, order, 'error').catch(() => '');
    错误.screenshotPath = screenshotPath;
    throw 错误;
  }
}

module.exports = {
  拼多多待回传发票页面地址,
  拼多多导出记录页面地址,
  读取页面正文,
  等待页面状态,
  是拼多多待开票列表文本,
  读取拼多多待开票页面状态,
  关闭拼多多逾期提醒弹窗,
  关闭拼多多非业务浮层,
  等待拼多多待开票列表或登录页,
  打开拼多多待回传发票页面,
  等待拼多多待开票列表加载,
  生成导出文件名,
  元素是否禁用,
  触发拼多多按钮DOM点击,
  读取当前页待回传订单,
  确认拼多多批量导出按钮可用,
  触发拼多多导出报表,
  转换拼多多导出下载错误,
  等待拼多多导出下载,
  打开拼多多导出记录页,
  等待并点击拼多多下载报表,
  下载最新拼多多导出报表,
  导出拼多多待回传订单,
  解析CSV文本,
  将CSV行转换为对象列表,
  清理拼多多导出占位值,
  读取拼多多订单发票类型,
  解析拼多多导出日期时间,
  计算已过工作日数,
  计算第几个工作日日期,
  格式化拼多多日期,
  构建拼多多财务开票参考,
  转换拼多多导出订单,
  读取拼多多导出订单,
  搜索拼多多回传订单,
  打开拼多多录入发票弹窗,
  定位拼多多录入发票弹窗,
  上传拼多多发票文件,
  填写拼多多发票号码,
  填写拼多多发票代码,
  读取拼多多录入发票错误文本列表,
  确认拼多多录入发票无错误,
  点击拼多多确认回传按钮,
  等待拼多多确认回传结果,
  等待拼多多确认回传按钮可用,
  拼多多录入发票弹窗是否打开,
  关闭拼多多录入发票弹窗,
  重置拼多多待回传列表页面,
  格式化截图时间,
  构建拼多多回传截图路径,
  保存拼多多回传截图,
  上传单张拼多多发票,
};
