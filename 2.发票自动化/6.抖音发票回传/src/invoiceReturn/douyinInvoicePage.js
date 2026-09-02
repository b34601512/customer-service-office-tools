const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { 等待抖音登录完成, 是抖音登录页面 } = require('../browser/douyinAuthenticatedPage');
const { 打印日志 } = require('../common/logger');
const { 截图目录, 规范化店铺标识 } = require('../common/paths');
const { 确保抖音目标店铺 } = require('../browser/douyinStoreIdentity');

const 抖音待回传发票页面地址 = 'https://fxg.jinritemai.com/ffa/morder/receipt/list';
const 抖音导出记录页面地址 = 'https://fxg.jinritemai.com/ffa/morder/receipt/report-list';
const 常规财务工作日 = 7;
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
  // 解决：抖音后台加载速度不固定，按真实状态等，不按固定秒数猜。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = await 读取页面正文(page).catch(() => '');
    if (predicate(text)) return text;
    await 等待短间隔(1000);
  }
  throw new Error(`${label}超时。`);
}

function 是抖音待开票列表文本(text) {
  // 解决：列表就绪必须同时出现消费者开票主界面和导出入口。
  const 正文 = String(text || '');
  const 有主界面 = 正文.includes('消费者申请开票记录') || 正文.includes('给消费者开票');
  const 有导出入口 = 正文.includes('导出订单') && 正文.includes('导出记录');
  const 有列表状态 = 正文.includes('上传发票') || /暂无数据|没有数据|无数据|共\s*0\s*条|待开票\s*0/.test(正文);
  return 有主界面 && 有导出入口 && 有列表状态;
}

function 是抖音待开票空列表文本(text) {
  // 解决：抖音没有待开票数据时仍允许点导出，必须先识别空列表避免误报超时。
  const 正文 = String(text || '').replace(/\s+/g, ' ');
  const 有主界面 = 正文.includes('消费者申请开票记录') || 正文.includes('给消费者开票');
  const 有待开票零 = /待开票\s*0(?!\d)/.test(正文);
  const 有空数据提示 = /暂无数据|没有数据|无数据|共\s*0\s*条/.test(正文);
  return 有主界面 && 有待开票零 && 有空数据提示;
}

function 创建抖音无待开票订单错误(message = '抖音当前店铺没有待回传发票订单。') {
  // 解决：把无订单做成明确业务状态，外层可以正常结束而不是按失败处理。
  const error = new Error(message);
  error.code = 'DOUYIN_NO_PENDING_INVOICE_ORDERS';
  return error;
}

function 是抖音无待开票订单错误(error) {
  // 解决：跨模块只按稳定错误码识别无订单状态，避免依赖文案完全一致。
  return String(error?.code || '').trim() === 'DOUYIN_NO_PENDING_INVOICE_ORDERS';
}

function 读取抖音待开票页面状态(url, text) {
  // 解决：业务页面被登录页拦截时立即进入登录等待，不白等列表超时。
  if (是抖音登录页面(url)) {
    return 'login';
  }
  if (是抖音待开票列表文本(text)) {
    return 'ready';
  }
  return 'loading';
}

async function 关闭抖音非业务浮层(page) {
  // 解决：消息、客服等悬浮层可能拦截业务按钮，关键点击前先禁用指针事件。
  await page.keyboard.press('Escape').catch(() => {});
  return page.evaluate(() => {
    const 目标选择器列表 = [
      '#umd_kits_home_entry',
      '[class*="im-web"]',
      '[class*="message"]',
      '[class*="customer-service"]',
    ];
    const 处理结果列表 = [];
    for (const selector of 目标选择器列表) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      element.setAttribute('data-douyin-invoice-overlay-disabled', '1');
      element.style.pointerEvents = 'none';
      处理结果列表.push({
        selector,
        text: String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    }
    return 处理结果列表;
  }).catch(() => []);
}

async function 检测抖音滑块验证(page) {
  // 解决：滑块未完成时列表数据接口不返回数据，必须停下等人工完成；只统计可见验证组件，避免残留隐藏 DOM 误判。
  try {
    const text = await 读取页面正文(page).catch(() => '');
    if (滑块验证特征列表.some((特征) => text.includes(特征))) return true;
    return await page.locator(滑块组件选择器).evaluateAll((elements) => elements.some((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
        && rect.width > 0
        && rect.height > 0;
    })).catch(() => false);
  } catch { return false; }
}

async function 等待抖音待开票列表或登录页(page, timeoutMs = 120_000) {
  // 解决：同时等待待开票列表和登录页，避免未登录时误判为页面加载慢。
  let startedAt = Date.now();
  let 滑块首次出现时间 = 0;
  let 已提示滑块 = false;
  while (Date.now() - startedAt < timeoutMs) {
    await 关闭抖音非业务浮层(page);
    const text = await 读取页面正文(page).catch(() => '');
    // 解决：验证完成后滑块节点可能仍残留在 DOM；列表或登录页一旦出现，必须优先结束滑块等待，否则会卡住当前店铺而无法进入下一家。
    const state = 读取抖音待开票页面状态(page.url(), text);
    if (state === 'ready' || state === 'login') {
      return { state, text, url: page.url() };
    }
    const 有滑块 = await 检测抖音滑块验证(page);
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
        打印日志('抖音登录', '滑块验证', '检测到滑动验证，程序已暂停自动操作，请在弹出的窗口完成滑块，完成后自动继续');
      }
      await page.bringToFront().catch(() => {});
      await 等待短间隔(1000);
      continue;
    }
    await 等待短间隔(1000);
  }
  throw new Error('等待抖音待开票列表加载超时。');
}

async function 等待抖音待开票列表加载(page) {
  // 解决：DOM 加载完成不代表列表接口完成，必须等业务文本出现。
  const result = await 等待抖音待开票列表或登录页(page);
  if (result.state === 'login') {
    throw new Error(`抖音待开票页面需要登录：${result.url}`);
  }
  return result.text;
}

async function 打开抖音待回传发票页面(page, 店铺配置 = {}, 选项 = {}) {
  // 解决：所有回传动作都从消费者开票列表进入，同手机号多店需先切到目标店铺（照抄 12.店铺指标的成熟切店方案）。
  const { 登录等待超时毫秒 = 15 * 60_000, onAction = null } = 选项;
  const 报告进度 = typeof onAction === 'function' ? onAction : null;
  await page.goto(抖音待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.bringToFront().catch(() => {});
  const 首次状态 = await 等待抖音待开票列表或登录页(page);
  if (首次状态.state === 'ready') {
    try {
      const 切店结果 = await 确保抖音目标店铺(page, 店铺配置, 报告进度);
      if (切店结果 && !切店结果.skipped && 切店结果.identity) {
        await page.goto(抖音待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        return 等待抖音待开票列表加载(page);
      }
    } catch (错误) {
      打印日志('抖音登录', '切店', 错误.message);
      throw 错误;
    }
    return 首次状态.text;
  }
  await 等待抖音登录完成(page, 店铺配置, { timeoutMs: 登录等待超时毫秒 });
  await page.goto(抖音待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const 加载后文本 = await 等待抖音待开票列表加载(page);
  try {
    const 切店结果 = await 确保抖音目标店铺(page, 店铺配置, 报告进度);
    if (切店结果 && !切店结果.skipped && 切店结果.identity) {
      await page.goto(抖音待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      return 等待抖音待开票列表加载(page);
    }
  } catch (错误) {
    打印日志('抖音登录', '切店', 错误.message);
    throw 错误;
  }
  return 加载后文本;
}

function 生成导出文件名(suggestedFilename) {
  // 解决：下载文件名可能重复，保存时加时间戳方便追溯。
  const safeName = String(suggestedFilename || 'douyin_invoice_export.xlsx').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_');
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeName}`;
}

async function 元素是否禁用(locator) {
  // 解决：抖音按钮可能只用 disabled class 表示禁用，不能只看 disabled 属性。
  if (!await locator.isEnabled().catch(() => false)) return true;
  return locator.evaluate((element) => {
    const className = String(element.className || '');
    return element.disabled === true || element.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/i.test(className);
  }).catch(() => false);
}

async function 触发抖音按钮DOM点击(locator, 动作名称 = '按钮') {
  // 解决：已定位到目标按钮后直接触发 DOM click，绕开悬浮层对鼠标坐标的拦截。
  try {
    await locator.evaluate((element) => {
      if (typeof element.click === 'function') {
        element.click();
        return;
      }
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
  } catch (错误) {
    throw new Error(`触发抖音${动作名称}失败：${错误.message}`);
  }
}

function 读取抖音行内操作状态(rowText) {
  const text = String(rowText || '');
  if (text.includes('上传发票')) return '可上传发票';
  if (text.includes('已上传')) return '已上传';
  if (text.includes('待确认')) return '待确认';
  return '待处理';
}

async function 读取当前页待回传订单(page, 店铺配置 = {}) {
  // 解决：同步与回传都读取待开票列表的全部订单，不再只看操作列含“上传发票”的行；
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
      .filter((text) => /\b\d{10,}\b/.test(text));
  });
  const 已存在订单号 = new Set();
  return rows.map((rowText) => {
    const orderNumber = rowText.match(/\b\d{10,}\b/)?.[0] || '';
    const operationStatus = 读取抖音行内操作状态(rowText);
    return {
      key: `${店铺配置.id || 'douyin'}:${orderNumber}`,
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

async function 读取抖音可见提示文本列表(page) {
  // 解决：抖音业务失败经常只出现在 toast 里，必须读取可见提示。
  return page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const selector = [
      '.auxo-message',
      '.auxo-message-notice',
      '.auxo-notification',
      '.auxo-notification-notice',
      '[role="alert"]',
      '[class*="toast"]',
    ].join(',');
    const texts = Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map((element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return Array.from(new Set(texts)).slice(0, 20);
  }).catch(() => []);
}

function 提取抖音导出业务错误(messageTexts = []) {
  // 解决：导出提交后优先识别平台业务提示，而不是等到 Playwright 超时。
  const 合并文本 = (Array.isArray(messageTexts) ? messageTexts : [messageTexts]).join(' ');
  if (/导出数据为0条|请调整查询条件后重试/.test(合并文本)) {
    return 创建抖音无待开票订单错误('抖音当前店铺没有待回传发票订单：导出数据为0条。');
  }
  return null;
}

async function 等待抖音导出任务提交结果(page, 选项 = {}) {
  // 解决：导出提交后只等待即时业务错误，随后直接去导出记录页等报表。
  const { timeoutMs = 8_000 } = 选项;
  const startedAt = Date.now();
  let 最后提示列表 = [];
  while (Date.now() - startedAt < timeoutMs) {
    const 提示列表 = await 读取抖音可见提示文本列表(page);
    if (提示列表.length > 0) {
      最后提示列表 = 提示列表;
    }
    const 业务错误 = 提取抖音导出业务错误(提示列表);
    if (业务错误) throw 业务错误;
    const 正文 = await 读取页面正文(page).catch(() => '');
    if (!String(正文 || '').includes('导出开票订单')) {
      return { status: 'submitted', messageTexts: 提示列表 };
    }
    const 提示文本 = 提示列表.join(' ');
    if (/导出任务.*成功|提交成功|创建成功|已创建/.test(提示文本)) {
      return { status: 'submitted', messageTexts: 提示列表 };
    }
    await 等待短间隔(1000);
  }
  return { status: 'submitted', messageTexts: 最后提示列表 };
}

async function 确认抖音导出订单按钮可用(page, 店铺配置 = {}) {
  // 解决：导出订单按钮禁用时抛出业务原因，不把 Playwright 重试日志给用户。
  const 导出订单按钮 = page.locator('button').filter({ hasText: /^导出订单$/ }).first();
  await 导出订单按钮.waitFor({ state: 'visible', timeout: 15_000 });
  if (!await 元素是否禁用(导出订单按钮)) {
    return 导出订单按钮;
  }
  const 当前页订单 = await 读取当前页待回传订单(page, 店铺配置).catch(() => []);
  if (当前页订单.length === 0) {
    throw new Error('抖音导出订单不可用：当前店铺没有待开票订单。');
  }
  throw new Error(`抖音导出订单不可用：页面已有 ${当前页订单.length} 单待开票订单，但导出按钮仍是禁用状态，请刷新页面后重试。`);
}

function 通知抖音动作(onAction, message) {
  // 解决：页面模块只通过一个动作回调向控制台持续反馈。
  if (typeof onAction === 'function') onAction(message);
}

async function 定位抖音导出抽屉(page) {
  // 解决：抖音导出入口可能是抽屉也可能是居中弹窗，统一按标题定位容器。
  const drawer = page.locator('.auxo-drawer.auxo-drawer-open, .auxo-drawer-open, [role="dialog"], .auxo-modal, [class*="modal"]').filter({ hasText: '导出开票订单' }).first();
  await drawer.waitFor({ state: 'visible', timeout: 30_000 });
  return drawer;
}

async function 点击抖音导出弹窗提交按钮(page) {
  // 解决：导出弹窗底部按钮可能因页面结构变化不在抽屉 locator 内，直接在真实可见弹窗里提交。
  const startedAt = Date.now();
  let result = null;
  while (Date.now() - startedAt < 15_000) {
    result = await page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const textOf = (element) => String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
    const nameOf = (element) => [
      textOf(element),
      element?.getAttribute('aria-label'),
      element?.getAttribute('title'),
      element?.getAttribute('value'),
    ].map((value) => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
    const disabled = (element) => element.disabled === true
      || element.getAttribute('disabled') != null
      || element.getAttribute('aria-disabled') === 'true'
      || /\bdisabled\b/i.test(String(element.className || ''));
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
      };
    };
    const isPrimaryButton = (item) => /primary|main|confirm|submit|auxo-btn-primary/i.test(item.className);
    const isCancelLikeButton = (item) => /取消|关闭|返回|放弃|稍后/.test(item.name)
      || /close|cancel/i.test(item.className);
    const canBeFallbackSubmitButton = (item) => !item.disabled
      && !isCancelLikeButton(item)
      && item.rect.width >= 40
      && item.rect.height >= 24;
    const containers = Array.from(document.querySelectorAll([
      '.auxo-drawer.auxo-drawer-open',
      '.auxo-drawer-open',
      '[role="dialog"]',
      '.auxo-modal',
      '[class*="modal"]',
      '[class*="drawer"]',
    ].join(',')))
      .filter((element) => visible(element) && textOf(element).includes('导出开票订单'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const controlsCount = Array.from(element.querySelectorAll('button,[role="button"],a,.auxo-btn,[class*="button"],[class*="btn"]')).filter(visible).length;
        return { element, area: rect.width * rect.height, controlsCount };
      })
      .sort((left, right) => (right.controlsCount - left.controlsCount) || (right.area - left.area));
    const container = containers[0]?.element;
    if (!container) {
      return { clicked: false, reason: '未找到导出开票订单弹窗。', controls: [] };
    }
    for (const element of [container, ...Array.from(container.querySelectorAll('*'))]) {
      if (element.scrollHeight > element.clientHeight) {
        element.scrollTop = element.scrollHeight;
      }
    }
    const controls = Array.from(container.querySelectorAll('button,[role="button"],a,.auxo-btn,[class*="button"],[class*="btn"]'))
      .filter(visible)
      .map((element) => ({
        element,
        text: textOf(element),
        name: nameOf(element),
        disabled: disabled(element),
        className: String(element.className || '').slice(0, 120),
        rect: rectOf(element),
      }));
    const 可点击非取消按钮列表 = controls.filter((item) => !item.disabled && !isCancelLikeButton(item));
    const 可点击常规按钮列表 = 可点击非取消按钮列表.filter((item) => canBeFallbackSubmitButton(item));
    const button = 可点击非取消按钮列表
      .find((item) => /^(导出|确认导出|确定导出|确认|确定|提交)$/.test(item.name))
      || 可点击非取消按钮列表.find(isPrimaryButton)
      || (可点击常规按钮列表.length === 1 ? 可点击常规按钮列表[0] : null)
      || (可点击非取消按钮列表.length === 1 ? 可点击非取消按钮列表[0] : null);
    if (!button) {
      const 可见按钮诊断列表 = controls
        .map(({ text, name, disabled: isDisabled, className, rect }) => ({ text, name, disabled: isDisabled, className, rect }));
      return {
        clicked: false,
        reason: '导出开票订单弹窗里没有可点击的提交按钮。',
        controls: 可见按钮诊断列表,
      };
    }
    if (typeof button.element.scrollIntoView === 'function') {
      button.element.scrollIntoView({ block: 'center', inline: 'center' });
    }
    for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      if (typeof button.element.dispatchEvent === 'function') {
        button.element.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
      }
    }
    if (typeof button.element.click === 'function') {
      button.element.click();
    }
    return {
      clicked: true,
      text: button.text,
      name: button.name,
      className: button.className,
      rect: button.rect,
      controls: controls.map(({ text, name, disabled: isDisabled, className, rect }) => ({ text, name, disabled: isDisabled, className, rect })),
    };
    });
    if (result?.clicked) {
      return result;
    }
    await 等待短间隔(500);
  }
  if (!result?.clicked) {
    const controlsText = (result?.controls || []).map((item) => {
      const rect = item.rect ? `${item.rect.width}x${item.rect.height}` : '';
      const className = item.className ? ` class=${item.className}` : '';
      return `${item.name || item.text || '无文字'}${item.disabled ? '(禁用)' : ''}${rect ? ` ${rect}` : ''}${className}`;
    }).join('，');
    throw new Error(`提交抖音导出任务失败：${result?.reason || '未知原因'}${controlsText ? `可见按钮：${controlsText}` : ''}`);
  }
  return result;
}

async function 触发抖音导出报表(page, 选项 = {}) {
  // 解决：抖音导出订单先生成报表，不会直接触发浏览器下载。
  const { onAction = null, 店铺配置 = {} } = 选项;
  const 列表文本 = await 等待抖音待开票列表加载(page);
  if (是抖音待开票空列表文本(列表文本)) {
    throw 创建抖音无待开票订单错误();
  }
  const 导出订单按钮 = await 确认抖音导出订单按钮可用(page, 店铺配置);
  通知抖音动作(onAction, '正在打开抖音导出订单抽屉。');
  await 关闭抖音非业务浮层(page);
  await 触发抖音按钮DOM点击(导出订单按钮, '导出订单');
  通知抖音动作(onAction, '正在等待抖音导出订单抽屉。');
  await 定位抖音导出抽屉(page);
  通知抖音动作(onAction, '正在提交抖音导出任务。');
  await 点击抖音导出弹窗提交按钮(page);
  await 等待抖音导出任务提交结果(page);
}

function 转换抖音导出下载错误(错误) {
  // 解决：下载事件失败时转成用户能判断的抖音导出原因。
  const message = String(错误?.message || 错误 || '').trim();
  if (/Target page, context or browser has been closed/i.test(message)) {
    return new Error('抖音导出订单失败：等待下载文件时页面或浏览器被关闭。');
  }
  if (/Timeout/i.test(message)) {
    return new Error('抖音导出订单失败：等待下载报表超时，可能是报表还没生成或登录状态失效。');
  }
  return new Error(`抖音导出订单失败：等待下载报表失败。${message}`);
}

async function 等待抖音导出下载(downloadPromise) {
  // 解决：集中等待下载事件，失败时抛出明确中文错误。
  try {
    return await downloadPromise;
  } catch (错误) {
    throw 转换抖音导出下载错误(错误);
  }
}

async function 打开抖音导出记录页(page) {
  // 解决：报表生成后直接进入导出记录页下载，避免依赖更多菜单弹层状态。
  await page.goto(抖音导出记录页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await 等待页面状态(page, '等待抖音导出记录页', 60_000, (text) => String(text || '').includes('发票导出记录') && String(text || '').includes('下载报表'));
}

function 解析抖音页面时间(text) {
  // 解决：导出记录按生成时间识别最新任务，避免下载旧报表。
  const match = String(text || '').match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function 读取抖音导出记录候选列表(page) {
  // 解决：下载最新报表时先采集可见记录，优先选择本次导出的记录。
  return page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return Array.from(document.querySelectorAll('tr, [role="row"], [class*="table-row"], [class*="report"]'))
      .filter(visible)
      .map((element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => text.includes('下载报表'));
  }).catch(() => []);
}

function 选择本次抖音导出记录(candidates = [], startedAt = null) {
  // 解决：有生成时间时优先选择本次导出后的记录，没有时间时退回第一条可下载记录。
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const 开始时间 = startedAt instanceof Date ? startedAt.getTime() - 120_000 : 0;
  const matched = candidates.find((text) => {
    const parsed = 解析抖音页面时间(text);
    return parsed && parsed.getTime() >= 开始时间;
  });
  return matched || candidates[0];
}

async function 点击抖音记录行下载按钮(page, rowText) {
  // 解决：下载按钮限制在目标记录行内，避免页面上多个下载按钮点错。
  const 标准文本 = String(rowText || '').trim();
  const reportId = 标准文本.match(/\b\d{12,}\b/)?.[0] || '';
  const row = reportId
    ? page.locator('tr, [role="row"], [class*="table-row"], [class*="report"]').filter({ hasText: reportId }).first()
    : page.locator('tr, [role="row"], [class*="table-row"], [class*="report"]').filter({ hasText: '下载报表' }).first();
  const 下载按钮 = row.locator('button, a').filter({ hasText: /^下载报表$/ }).first();
  await 下载按钮.waitFor({ state: 'visible', timeout: 15_000 });
  if (await 元素是否禁用(下载按钮)) {
    throw new Error('抖音导出订单失败：目标导出记录的下载报表按钮不可用。');
  }
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  downloadPromise.catch(() => {});
  await 关闭抖音非业务浮层(page);
  await 触发抖音按钮DOM点击(下载按钮, '下载报表');
  return 等待抖音导出下载(downloadPromise);
}

async function 等待并点击抖音下载报表(page, 选项 = {}) {
  // 解决：报表可能需要生成时间，按下载按钮可用状态轮询。
  const { timeoutMs = 180_000, startedAt = null, onAction = null } = 选项;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await 关闭抖音非业务浮层(page);
    const candidates = await 读取抖音导出记录候选列表(page);
    const selected = 选择本次抖音导出记录(candidates, startedAt);
    if (selected) {
      通知抖音动作(onAction, '正在下载抖音导出报表。');
      return 点击抖音记录行下载按钮(page, selected);
    }
    const 刷新按钮 = page.locator('button').filter({ hasText: /^刷新$/ }).first();
    if (await 刷新按钮.count() && !await 元素是否禁用(刷新按钮)) {
      await 刷新按钮.click().catch(() => {});
    }
    通知抖音动作(onAction, '正在等待抖音导出报表生成。');
    await 等待短间隔(3000);
  }
  throw new Error('抖音导出订单失败：导出记录页没有等到可下载报表。');
}

async function 下载最新抖音导出报表(page, outputDirectory, 选项 = {}) {
  // 解决：从导出记录页下载最新报表，并落盘到本项目运行目录。
  const { onAction = null, startedAt = null } = 选项;
  fs.mkdirSync(outputDirectory, { recursive: true });
  通知抖音动作(onAction, '正在打开抖音导出记录页。');
  await 打开抖音导出记录页(page);
  通知抖音动作(onAction, '正在等待抖音报表生成。');
  const download = await 等待并点击抖音下载报表(page, { startedAt, onAction });
  const exportFilePath = path.join(outputDirectory, 生成导出文件名(download.suggestedFilename()));
  通知抖音动作(onAction, '正在保存抖音导出报表。');
  await download.saveAs(exportFilePath);
  const failure = await download.failure();
  if (failure) throw new Error(`抖音导出订单失败：${failure}`);
  return exportFilePath;
}

async function 导出抖音待回传订单(page, outputDirectory, 选项 = {}) {
  // 解决：完整执行生成报表和下载报表，后续订单字段只解析导出文件。
  const { onAction = null, 店铺配置 = {} } = 选项;
  await 关闭抖音非业务浮层(page);
  const startedAt = new Date();
  await 触发抖音导出报表(page, { onAction, 店铺配置 });
  return 下载最新抖音导出报表(page, outputDirectory, { onAction, startedAt });
}

function 去除UTF8BOM(text) {
  // 解决：导出的 CSV 可能带 BOM，表头匹配前必须移除。
  return String(text || '').replace(/^\uFEFF/, '');
}

function 解析CSV文本(text) {
  // 解决：保留 CSV 解析兼容旧测试文件，真实抖音导出优先解析 xlsx。
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

function 查找ZIP中央目录结束(buffer) {
  // 解决：xlsx 本质是 zip，先从文件尾定位中央目录。
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 66000); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('解析抖音 xlsx 失败：未找到 ZIP 中央目录。');
}

function 读取ZIP条目索引(buffer) {
  // 解决：按中央目录读取每个文件条目，兼容带数据描述符的 zip。
  const endOffset = 查找ZIP中央目录结束(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('解析抖音 xlsx 失败：ZIP 中央目录结构异常。');
    }
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer.slice(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');
    entries.set(fileName, { compressionMethod, compressedSize, localHeaderOffset });
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function 解压ZIP条目(buffer, entry) {
  // 解决：只解压 xlsx 需要的 XML 条目，不引入额外依赖。
  if (!entry) return '';
  const localOffset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error('解析抖音 xlsx 失败：ZIP 本地文件头异常。');
  }
  const fileNameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed.toString('utf8');
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed).toString('utf8');
  throw new Error(`解析抖音 xlsx 失败：不支持的 ZIP 压缩方式 ${entry.compressionMethod}。`);
}

function 解码XML文本(text) {
  // 解决：xlsx XML 文本需要还原实体，保证中文表头准确匹配。
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function 读取XLSX共享字符串(sharedStringsXml = '') {
  // 解决：xlsx 单元格经常用共享字符串表保存中文内容。
  const sharedStrings = [];
  const source = String(sharedStringsXml || '');
  const siMatches = source.match(/<si[\s\S]*?<\/si>/g) || [];
  for (const si of siMatches) {
    const texts = Array.from(si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) => 解码XML文本(match[1]));
    sharedStrings.push(texts.join(''));
  }
  return sharedStrings;
}

function 列字母转索引(cellRef = '') {
  // 解决：xlsx 单元格以 A1 形式标记列号，解析成数组下标。
  const letters = String(cellRef || '').replace(/[0-9]/g, '').toUpperCase();
  if (!letters) return -1;
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + (letter.charCodeAt(0) - 64);
  }
  return value - 1;
}

function 读取单元格属性(cellXml, attrName) {
  // 解决：单元格属性读取集中处理双引号和单引号。
  const match = String(cellXml || '').match(new RegExp(`${attrName}=["']([^"']+)["']`));
  return match ? match[1] : '';
}

function 读取XLSX单元格值(cellXml, sharedStrings = []) {
  // 解决：按单元格类型还原真实文本，供后续表头匹配。
  const type = 读取单元格属性(cellXml, 't');
  if (type === 'inlineStr') {
    const texts = Array.from(String(cellXml || '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) => 解码XML文本(match[1]));
    return texts.join('').trim();
  }
  const valueText = String(cellXml || '').match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || '';
  if (type === 's') {
    return String(sharedStrings[Number(valueText)] || '').trim();
  }
  return 解码XML文本(valueText).trim();
}

function 读取XLSX工作表行(sheetXml = '', sharedStrings = []) {
  // 解决：把 xlsx 第一张工作表还原成二维表格，保留空列位置。
  const rows = [];
  const rowMatches = String(sheetXml || '').match(/<row[\s\S]*?<\/row>/g) || [];
  for (const rowXml of rowMatches) {
    const row = [];
    let fallbackIndex = 0;
    const cellMatches = rowXml.match(/<c[\s\S]*?<\/c>/g) || [];
    for (const cellXml of cellMatches) {
      const ref = 读取单元格属性(cellXml, 'r');
      const index = 列字母转索引(ref);
      const finalIndex = index >= 0 ? index : fallbackIndex;
      row[finalIndex] = 读取XLSX单元格值(cellXml, sharedStrings);
      fallbackIndex = finalIndex + 1;
    }
    if (row.some((cell) => String(cell || '').trim())) {
      rows.push(row.map((cell) => String(cell || '').trim()));
    }
  }
  return rows;
}

function 解析XLSX工作簿(filePath) {
  // 解决：读取抖音导出的 xlsx，不重新造发票下载功能。
  const buffer = fs.readFileSync(filePath);
  const entries = 读取ZIP条目索引(buffer);
  const sharedStrings = 读取XLSX共享字符串(解压ZIP条目(buffer, entries.get('xl/sharedStrings.xml')));
  const sheetPath = Array.from(entries.keys()).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetPath) throw new Error('解析抖音 xlsx 失败：未找到工作表。');
  return 读取XLSX工作表行(解压ZIP条目(buffer, entries.get(sheetPath)), sharedStrings);
}

function 将XLSX行转换为对象列表(rows) {
  // 解决：抖音 xlsx 前两行是说明和筛选条件，真实表头需要自动定位。
  const headerIndex = rows.findIndex((row) => row.includes('订单编号') && row.some((cell) => String(cell || '').includes('发票')));
  if (headerIndex < 0) {
    throw new Error('解析抖音 xlsx 失败：未找到订单表头。');
  }
  const headers = rows[headerIndex].map((header) => String(header || '').trim());
  return rows.slice(headerIndex + 1).map((row) => Object.fromEntries(headers.map((header, index) => [
    header,
    String(row[index] || '').trim(),
  ])));
}

function 清理抖音导出占位值(value) {
  // 解决：抖音导出用短横线表示空值，业务字段里统一转为空。
  const text = String(value || '').trim();
  return text === '-' ? '' : text;
}

function 读取抖音订单号(row = {}) {
  // 解决：真实导出表头是订单编号，兼容旧测试里的订单号。
  return 清理抖音导出占位值(row['订单编号'] || row['订单号']);
}

function 读取抖音订单发票类型(row = {}) {
  // 解决：不同页面显示“蓝票/电票”，导出文件优先取完整发票类型。
  return 清理抖音导出占位值(row['发票类型'] || row['发票种类'] || '');
}

function 解析抖音导出日期时间(value) {
  // 解决：抖音导出时间要参与财务开票参考，先统一解析成 Date。
  const text = 清理抖音导出占位值(value);
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

function 格式化抖音日期(date) {
  // 解决：财务参考日期只展示到天，减少弹窗信息噪声。
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function 构建抖音财务开票参考(invoiceApplyTime, now = new Date()) {
  // 解决：把“财务约 7 个工作日开票”的经验固定显示到订单行里。
  const applyDate = 解析抖音导出日期时间(invoiceApplyTime);
  if (!applyDate) return invoiceApplyTime ? '财务参考：申请时间格式未识别' : '财务参考：未获取申请时间';
  const elapsedWorkdays = 计算已过工作日数(applyDate, now);
  if (elapsedWorkdays >= 常规财务工作日) {
    return `财务参考：已过 ${elapsedWorkdays} 个工作日，超过常规 ${常规财务工作日} 个工作日`;
  }
  const estimatedDate = 计算第几个工作日日期(applyDate, 常规财务工作日);
  return `财务参考：已过 ${elapsedWorkdays} 个工作日，常规约 ${常规财务工作日} 个工作日，预计 ${格式化抖音日期(estimatedDate)} 前后`;
}

function 转换抖音导出订单(row = {}, 店铺配置 = {}) {
  // 解决：把抖音 xlsx 行转换成回传流程稳定订单对象。
  const orderNumber = 读取抖音订单号(row);
  const invoiceApplyTime = 清理抖音导出占位值(row['申请时间']);
  return {
    key: `${店铺配置.id}:${orderNumber}`,
    storeId: 店铺配置.id,
    storeName: 店铺配置.name,
    orderNumber,
    subOrderNumber: 清理抖音导出占位值(row['子订单编号']),
    invoiceAmount: 清理抖音导出占位值(row['发票金额（单位：元）'] || row['发票金额']),
    invoiceType: 读取抖音订单发票类型(row),
    invoiceApplyTime,
    promisedInvoiceTime: 清理抖音导出占位值(row['最晚开票时间'] || row['承诺开票时间']),
    financeIssueReference: 构建抖音财务开票参考(invoiceApplyTime),
    invoiceTitleType: 清理抖音导出占位值(row['抬头类型']),
    invoiceTitle: 清理抖音导出占位值(row['发票抬头']),
    buyerTaxNumber: 清理抖音导出占位值(row['税号'] || row['企业税号']),
    orderStatus: 清理抖音导出占位值(row['订单状态']),
    invoiceStatus: 清理抖音导出占位值(row['发票状态']),
    invoiceUploadMode: 清理抖音导出占位值(row['开票方式']),
    raw: row,
  };
}

function 读取抖音导出对象列表(exportFilePath) {
  // 解决：真实导出是 xlsx，同时保留 CSV 文件的轻量兼容。
  const extension = path.extname(exportFilePath).toLowerCase();
  if (extension === '.csv') {
    return 将CSV行转换为对象列表(解析CSV文本(fs.readFileSync(exportFilePath, 'utf8')));
  }
  return 将XLSX行转换为对象列表(解析XLSX工作簿(exportFilePath));
}

function 读取抖音导出订单(exportFilePath, 店铺配置 = {}) {
  // 解决：导出报表是订单字段来源，解析后供下载和上传复用。
  const objects = 读取抖音导出对象列表(exportFilePath);
  const 已存在订单号 = new Set();
  return objects.map((row) => 转换抖音导出订单(row, 店铺配置))
    .filter((order) => {
      if (!order.orderNumber || 已存在订单号.has(order.orderNumber)) return false;
      已存在订单号.add(order.orderNumber);
      return true;
    });
}

async function 搜索抖音回传订单(page, orderNumber) {
  // 解决：上传前按订单号过滤列表，避免点错其它订单的上传发票。
  const 订单号 = String(orderNumber || '').trim();
  if (!订单号) throw new Error('搜索抖音回传订单失败：订单号为空。');
  await page.goto(抖音待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await 等待抖音待开票列表加载(page);
  await 关闭抖音非业务浮层(page);
  await page.locator('input[placeholder="请输入订单编号"]').first().fill(订单号);
  await page.locator('button').filter({ hasText: /^查询$/ }).first().click();
  await 等待页面状态(page, `等待抖音订单 ${订单号} 搜索结果`, 60_000, (text) => String(text || '').includes(订单号) && String(text || '').includes('上传发票'));
}

async function 打开抖音上传发票抽屉(page, orderNumber) {
  // 解决：只在目标订单所在行点击上传发票，避免多个同名操作混淆。
  const 订单号 = String(orderNumber || '').trim();
  await 关闭抖音非业务浮层(page);
  const row = page.locator('tr, [role="row"]').filter({ hasText: 订单号 }).first();
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.locator('text=上传发票').last().click();
  await 等待页面状态(page, '等待抖音上传发票抽屉打开', 30_000, (text) => {
    const 正文 = String(text || '');
    return 正文.includes('上传发票') && 正文.includes(订单号) && 正文.includes('提交');
  });
}

function 定位抖音上传发票抽屉(page) {
  // 解决：上传和提交都限制在上传发票抽屉内，不误操作页面筛选输入框。
  return page.locator('.auxo-drawer.auxo-drawer-open, .auxo-drawer-open').filter({ hasText: '上传发票' }).first();
}

async function 上传抖音发票文件(page, invoiceFilePath) {
  // 解决：直接设置真实文件 input，不模拟人工选择文件。
  if (!fs.existsSync(invoiceFilePath)) {
    throw new Error(`上传抖音发票失败：文件不存在 ${invoiceFilePath}`);
  }
  const drawer = 定位抖音上传发票抽屉(page);
  const fileInput = drawer.locator('input[type="file"]').first();
  if (await fileInput.count()) {
    await fileInput.setInputFiles(invoiceFilePath);
  } else {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 8000 });
    await drawer.locator('button, span, div').filter({ hasText: /^上传发票$/ }).last().click();
    const chooser = await chooserPromise;
    await chooser.setFiles(invoiceFilePath);
  }
  const fileName = path.basename(invoiceFilePath);
  await 等待页面状态(page, '等待抖音发票文件上传完成', 180_000, (text) => String(text || '').includes(fileName));
}

function 标准化可见文本(text) {
  // 解决：错误提示里换行和多空格会影响去重，统一压成一行。
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function 格式化抖音错误文本列表(errorTexts = []) {
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

async function 读取抖音上传发票错误文本列表(page) {
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
    const errorRule = /请上传|请完善信息|请填写|提交失败|上传失败|校验失败|操作失败|不能为空|必填|不一致/;
    return Array.from(document.querySelectorAll('body *'))
      .filter(visible)
      .map(text)
      .filter((item) => item && item.length <= 160 && errorRule.test(item));
  }).catch(() => []);
  return 格式化抖音错误文本列表(errorTexts);
}

async function 确认抖音上传发票无错误(page, label = '抖音上传发票校验失败') {
  // 解决：明确红字直接抛出，让用户知道真实失败原因。
  const 错误文本列表 = await 读取抖音上传发票错误文本列表(page);
  if (错误文本列表.length > 0) {
    throw new Error(`${label}：${错误文本列表.join('；')}`);
  }
}

async function 确认抖音提交发票(page) {
  // 解决：上传抽屉的提交只会打开确认弹窗，确认才是平台实际回传动作。
  const 确认弹窗 = page.locator('.auxo-modal, [role="dialog"]').filter({ hasText: '提交发票' }).last();
  await 确认弹窗.waitFor({ state: 'visible', timeout: 30_000 });
  await 确认弹窗.locator('button').filter({ hasText: /^确认$/ }).click();
}

async function 等待抖音提交回传结果(page, orderNumber, timeoutMs = 60_000) {
  // 解决：提交后同时等待抽屉关闭和红字错误，不把失败拖成超时。
  const 订单号 = String(orderNumber || '').trim();
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const 错误文本列表 = await 读取抖音上传发票错误文本列表(page);
    if (错误文本列表.length > 0) {
      throw new Error(`抖音确认回传失败：${错误文本列表.join('；')}`);
    }
    const text = await 读取页面正文(page).catch(() => '');
    const 抽屉仍打开 = String(text || '').includes('上传发票') && (!订单号 || String(text || '').includes(订单号));
    if (!抽屉仍打开) {
      return true;
    }
    await 等待短间隔(1000);
  }
  throw new Error(`等待抖音订单 ${订单号} 确认回传超时。`);
}

async function 抖音上传发票抽屉是否打开(page) {
  // 解决：失败后继续下一单前先判断抽屉是否还挡着列表。
  const text = await 读取页面正文(page).catch(() => '');
  return String(text || '').includes('上传发票') && String(text || '').includes('提交');
}

async function 关闭抖音上传发票抽屉(page, timeoutMs = 8000) {
  // 解决：单张失败后关闭抽屉，保证下一单从干净列表开始。
  if (!await 抖音上传发票抽屉是否打开(page)) {
    return false;
  }
  const drawer = 定位抖音上传发票抽屉(page);
  const 取消按钮 = drawer.locator('button').filter({ hasText: /^取消$/ }).last();
  if (await 取消按钮.count()) {
    await 取消按钮.click({ timeout: 5000 }).catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!await 抖音上传发票抽屉是否打开(page)) {
      return true;
    }
    await 等待短间隔(300);
  }
  return false;
}

async function 重置抖音待回传列表页面(page) {
  // 解决：失败后回到消费者开票页，避免历史页或抽屉状态污染下一单。
  await 关闭抖音上传发票抽屉(page).catch(() => false);
  await page.goto(抖音待回传发票页面地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await 等待抖音待开票列表加载(page);
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

function 构建抖音回传截图路径(order = {}, 状态文本 = 'success') {
  // 解决：每个订单单独生成截图凭证，方便弹窗逐单打开核对。
  const 店铺标识 = 规范化店铺标识(order.storeId || order.storeName || 'douyin');
  const 订单号 = String(order.orderNumber || '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-');
  const 文件名 = `douyin-invoice-return-${店铺标识}-${订单号}-${状态文本}-${格式化截图时间()}.png`;
  return path.join(截图目录, 文件名);
}

async function 保存抖音回传截图(page, order, 状态文本) {
  // 解决：上传结果以抖音页面截图为凭证，截图偶发失败时先重试再暴露。
  fs.mkdirSync(截图目录, { recursive: true });
  let 最后错误 = null;
  for (let count = 0; count < 3; count += 1) {
    const 截图路径 = 构建抖音回传截图路径(order, 状态文本);
    try {
      await page.screenshot({ path: 截图路径, fullPage: true });
      return 截图路径;
    } catch (错误) {
      最后错误 = 错误;
      await 等待短间隔(500);
    }
  }
  throw new Error(`保存抖音回传截图失败：${最后错误?.message || '未知错误'}`);
}

async function 采集抖音上传抽屉状态(page) {
  // 解决：上传后保留可审计状态，便于判断是否已经到提交前一步。
  return page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const shortText = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const controls = Array.from(document.querySelectorAll('button,a,input,[role="button"]'))
      .filter(visible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: shortText(element.innerText || element.textContent || element.getAttribute('placeholder') || element.value || ''),
        type: element.getAttribute('type') || '',
        className: String(element.className || '').slice(0, 160),
      }));
    return {
      url: location.href,
      title: document.title,
      bodyTextSample: shortText(document.body?.innerText || ''),
      controls,
      canSubmit: controls.some((item) => item.text === '提交'),
    };
  });
}

async function 上传单张抖音发票({ page, order, invoiceFilePath, submit = false, onAction = null } = {}) {
  // 解决：单张回传只做搜索、打开、上传和可选提交，不掺入下载逻辑。
  const 通知动作 = (message) => 通知抖音动作(onAction, message);
  try {
    通知动作(`正在搜索抖音订单 ${order.orderNumber}。`);
    await 搜索抖音回传订单(page, order.orderNumber);
    通知动作(`正在打开抖音订单 ${order.orderNumber} 的上传发票抽屉。`);
    await 打开抖音上传发票抽屉(page, order.orderNumber);
    通知动作('正在上传抖音发票文件。');
    await 上传抖音发票文件(page, invoiceFilePath);
    通知动作('正在检查抖音上传信息。');
    await 确认抖音上传发票无错误(page, '抖音提交前校验失败');
    const modalState = await 采集抖音上传抽屉状态(page);
    let screenshotPath = '';
    if (submit) {
      通知动作('正在提交抖音发票回传。');
      const drawer = 定位抖音上传发票抽屉(page);
      await drawer.locator('button').filter({ hasText: /^提交$/ }).last().click();
      await 确认抖音提交发票(page);
      通知动作('正在等待抖音确认回传结果。');
      await 等待抖音提交回传结果(page, order.orderNumber);
      通知动作('正在保存抖音回传截图凭证。');
      screenshotPath = await 保存抖音回传截图(page, order, 'success');
    }
    return {
      invoiceNumber: String(order?.invoiceNumber || '').trim(),
      invoiceCode: String(order?.invoiceCode || '').trim(),
      modalState,
      screenshotPath,
      submitted: submit === true,
    };
  } catch (错误) {
    const screenshotPath = await 保存抖音回传截图(page, order, 'error').catch(() => '');
    错误.screenshotPath = screenshotPath;
    throw 错误;
  }
}

module.exports = {
  抖音待回传发票页面地址,
  抖音导出记录页面地址,
  读取页面正文,
  等待页面状态,
  是抖音待开票列表文本,
  是抖音待开票空列表文本,
  创建抖音无待开票订单错误,
  是抖音无待开票订单错误,
  读取抖音待开票页面状态,
  关闭抖音非业务浮层,
  等待抖音待开票列表或登录页,
  打开抖音待回传发票页面,
  等待抖音待开票列表加载,
  生成导出文件名,
  元素是否禁用,
  触发抖音按钮DOM点击,
  读取当前页待回传订单,
  读取抖音可见提示文本列表,
  提取抖音导出业务错误,
  等待抖音导出任务提交结果,
  确认抖音导出订单按钮可用,
  点击抖音导出弹窗提交按钮,
  触发抖音导出报表,
  转换抖音导出下载错误,
  等待抖音导出下载,
  打开抖音导出记录页,
  解析抖音页面时间,
  读取抖音导出记录候选列表,
  选择本次抖音导出记录,
  等待并点击抖音下载报表,
  下载最新抖音导出报表,
  导出抖音待回传订单,
  解析CSV文本,
  将CSV行转换为对象列表,
  查找ZIP中央目录结束,
  读取ZIP条目索引,
  解压ZIP条目,
  解码XML文本,
  读取XLSX共享字符串,
  列字母转索引,
  读取单元格属性,
  读取XLSX单元格值,
  读取XLSX工作表行,
  解析XLSX工作簿,
  将XLSX行转换为对象列表,
  清理抖音导出占位值,
  读取抖音订单号,
  读取抖音订单发票类型,
  解析抖音导出日期时间,
  计算已过工作日数,
  计算第几个工作日日期,
  格式化抖音日期,
  构建抖音财务开票参考,
  转换抖音导出订单,
  读取抖音导出订单,
  搜索抖音回传订单,
  打开抖音上传发票抽屉,
  定位抖音上传发票抽屉,
  上传抖音发票文件,
  读取抖音上传发票错误文本列表,
  确认抖音上传发票无错误,
  等待抖音提交回传结果,
  抖音上传发票抽屉是否打开,
  关闭抖音上传发票抽屉,
  重置抖音待回传列表页面,
  格式化截图时间,
  构建抖音回传截图路径,
  保存抖音回传截图,
  采集抖音上传抽屉状态,
  上传单张抖音发票,
};
