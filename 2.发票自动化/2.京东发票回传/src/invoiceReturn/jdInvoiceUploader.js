const fs = require('fs');
const path = require('path');
const { 打印日志 } = require('../common/logger');
const {
  创建店铺浏览器上下文,
  保存店铺浏览器登录态,
} = require('../browser/storeBrowser');
const { 注册浏览器上下文, 关闭店铺浏览器上下文 } = require('../browser/browserContextHub');
const { 打开目标页面 } = require('../browser/openTargetPage');
const { 等待直到 } = require('../browser/dynamicWait');
const { 截图目录, 规范化店铺标识 } = require('../common/paths');
const { 规范化凭证名称, 验证凭证文件, 格式化凭证时间 } = require('../common/evidenceService');
const { 进入消费者发票页面 } = require('../consumerInvoice/enterConsumerInvoicePage');
const { 归类发票状态 } = require('../consumerInvoice/invoiceApiMapper');
const { 禁用常见遮挡浮层, 获取顶部全部标签点击点, 读取顶部发票标签状态 } = require('../consumerInvoice/allInvoiceTab');

const 默认发票备注文本 = '京东';

async function 定位第一个可见元素(容器, 选择器列表) {
  // 解决：京东后台按钮文案和 DOM 结构会变，按语义逐个寻找真实可见元素。
  for (const 选择器 of 选择器列表) {
    const 元素 = 容器.locator(选择器).first();
    if (await 元素.count() === 0) continue;
    if (await 元素.isVisible().catch(() => false)) return 元素;
  }
  return null;
}

async function 定位第一个可见可用元素(容器, 选择器列表) {
  // 解决：提交按钮必须可见且可点击，避免误点还没识别完文件的禁用按钮。
  for (const 选择器 of 选择器列表) {
    const 元素 = 容器.locator(选择器).first();
    if (await 元素.count() === 0) continue;
    if (await 元素.isVisible().catch(() => false) && await 元素.isEnabled().catch(() => false)) return 元素;
  }
  return null;
}

async function 通知上传阶段(onUploadProgress, item, message, stage) {
  // 解决：上传阶段每个等待点都向控制台报告，避免用户只能看到黑箱“上传中”。
  if (typeof onUploadProgress === 'function') {
    await onUploadProgress(item, { message, stage });
  }
}

async function 页面存在京东加载提示(page) {
  // 解决：京东列表还在加载时禁止做“入口不存在”的否定判断，避免把慢加载误判成失败。
  return page.evaluate(() => {
    const 加载选择器列表 = [
      '.ant-spin-spinning',
      '.ant-spin-dot',
      '.ant-spin-text',
      '.next-loading',
      '.next-loading-mask',
      '.next-loading-tip',
      '.el-loading-mask',
      '.el-loading-spinner',
      '[class*="loading-mask"]',
      '[class*="loading-spinner"]',
      '[class*="LoadingMask"]',
      '[class*="LoadingSpinner"]',
      '[class*="spin-spinning"]',
      '[class*="SpinSpinning"]',
    ];
    const 元素可见 = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const 加载元素 = Array.from(document.querySelectorAll(加载选择器列表.join(',')));
    if (加载元素.some((element) => 元素可见(element))) return true;

    const 加载文案 = /加载中|正在加载|请稍候/;
    const 文本元素 = Array.from(document.querySelectorAll('body *'));
    return 文本元素.some((element) => {
      if (!元素可见(element)) return false;
      const text = String(element.textContent || '').replace(/\s+/g, '');
      return text.length > 0 && text.length <= 30 && 加载文案.test(text);
    });
  }).catch(() => false);
}

async function 等待京东页面停止加载(page) {
  // 解决：上传入口判断必须等京东页面稳定，不能在遮罩层还在时直接判失败。
  await 等待直到(page, async () => !(await 页面存在京东加载提示(page)), {
    timeoutMs: 60_000,
    intervalMs: 500,
    超时消息: '京东后台列表一直处于加载中，无法判断发票回传入口。',
  });
}

async function 等待京东发票列表标签就绪(page) {
  // 解决：切换“全部”前先等顶部发票标签渲染完成，避免页面刚打开时误判找不到标签。
  await 等待直到(page, async () => {
    const 页面文本 = await page.locator('body').innerText().catch(() => '');
    return /消费者发票/.test(页面文本) && /全部/.test(页面文本) && /待开票/.test(页面文本);
  }, {
    timeoutMs: 60_000,
    intervalMs: 500,
    超时消息: '京东消费者发票页顶部标签一直未就绪，无法切换到全部列表。',
  });
}

async function 切到京东全部发票列表(page) {
  // 解决：已开票订单会离开“待开票”列表，回传前必须在“全部”里判断真实状态。
  await 等待京东发票列表标签就绪(page);
  await 等待京东页面停止加载(page);
  const 当前标签状态 = await 读取顶部发票标签状态(page);
  if (当前标签状态.allActive) return;
  await 禁用常见遮挡浮层(page);
  const 点击点 = await 获取顶部全部标签点击点(page);
  if (!点击点?.ok) {
    throw new Error(`切换京东全部发票列表失败：${点击点?.message || '未找到顶部“全部”标签。'}`);
  }
  await page.mouse.click(点击点.x, 点击点.y);
  await 等待直到(page, async () => {
    const 标签状态 = await 读取顶部发票标签状态(page);
    return 标签状态.allActive ? 标签状态 : null;
  }, {
    timeoutMs: 15_000,
    intervalMs: 300,
    超时消息: '已点击京东顶部“全部”标签，但页面没有切换到全部列表。',
  });
  await 等待京东页面停止加载(page);
}

function 构建订单文本选择器(orderNumber) {
  // 解决：订单号进入 Playwright 文本选择器前先转义，避免特殊字符破坏查询。
  return String(orderNumber || '').replace(/["\\]/g, '\\$&');
}

async function 定位订单查询输入框(page) {
  // 解决：京东回传前必须先把列表收窄到当前订单，避免上传到错误行。
  const 输入框列表 = page.locator('input:not([readonly])');
  const 输入框数量 = await 输入框列表.count();
  for (let 索引 = 0; 索引 < 输入框数量; 索引 += 1) {
    const 输入框 = 输入框列表.nth(索引);
    if (!await 输入框.isVisible().catch(() => false)) continue;
    const 命中订单标签 = await 输入框.evaluate((element) => {
      let parent = element.parentElement;
      for (let level = 0; level < 6 && parent; level += 1, parent = parent.parentElement) {
        if (['BODY', 'HTML'].includes(parent.tagName)) continue;
        const text = String(parent.innerText || parent.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 0 && text.length <= 80 && /订单编号|订单号/.test(text) && !/AI搜索|有问题点我直接问/.test(text)) {
          return true;
        }
      }
      return false;
    }).catch(() => '');
    if (命中订单标签) {
      return 输入框;
    }
  }
  return null;
}

async function 查询京东订单(page, orderNumber) {
  // 解决：用订单号定位京东发票列表中的唯一回传目标。
  const 查询输入框 = await 等待直到(page, () => 定位订单查询输入框(page), {
    timeoutMs: 60_000,
    intervalMs: 500,
    超时消息: '京东后台没有找到订单号查询框，请确认店铺目标地址是常规开票列表页。',
  });
  await 查询输入框.fill(orderNumber);
  await 查询输入框.press('Enter').catch(() => {});
  const 查询按钮 = await 定位第一个可见元素(page, [
    'button:has-text("查询")',
    'button:has-text("搜索")',
    'a:has-text("查询")',
    'a:has-text("搜索")',
  ]);
  if (查询按钮) {
    await 查询按钮.click();
  }
  打印日志('发票回传', '京东上传', `已提交京东订单查询：${orderNumber}`);
}

async function 重新查询京东订单列表(page, orderNumber) {
  // 解决：上传后京东发票列表不会自动刷新，必须重新点击“查询”才能看到京东返回的新结果。
  const 查询按钮 = await 定位第一个可见元素(page, [
    'button:has-text("查询")',
    'button:has-text("搜索")',
    'a:has-text("查询")',
    'a:has-text("搜索")',
  ]);
  if (!查询按钮) return false;
  await 查询按钮.click();
  打印日志('发票回传', '京东上传', `已重新点击查询按钮刷新列表：${orderNumber}`);
  return true;
}

async function 读取京东订单回传前状态(page, orderNumber) {
  // 解决：复用现有发票状态归类语义，先判断订单是否已开票成功，再决定是否上传。
  const 订单状态 = await page.evaluate((订单号) => {
    const 规范文本 = (text) => String(text || '').replace(/\s+/g, ' ').trim();
    const 订单行文本列表 = Array.from(document.querySelectorAll('tr'))
      .map((element) => 规范文本(element.innerText || element.textContent))
      .filter((text) => text.includes(订单号));
    const 页面文本 = 规范文本(document.body.innerText || document.body.textContent || '');
    return {
      found: 订单行文本列表.length > 0,
      rowText: 订单行文本列表[0] || '',
      noData: /暂无数据|共\s*0\s*条/.test(页面文本),
    };
  }, String(orderNumber || ''));
  const invoiceStatusKind = 归类发票状态(订单状态.rowText);
  return {
    ...订单状态,
    invoiceStatusKind,
    alreadyInvoiced: invoiceStatusKind === 'success',
  };
}

async function 等待京东订单查询结果(page, orderNumber) {
  // 解决：订单查询必须等到“找到订单”或“确认无数据”，不能让 locator 超时暴露英文报错。
  return 等待直到(page, async () => {
    if (await 页面存在京东加载提示(page)) return null;
    const 订单状态 = await 读取京东订单回传前状态(page, orderNumber);
    if (订单状态.found || 订单状态.noData) {
      return 订单状态;
    }
    return null;
  }, {
    timeoutMs: 60_000,
    intervalMs: 500,
    超时消息: `京东后台全部列表查询订单 ${orderNumber} 超时，未看到订单行或空结果提示。`,
  });
}

async function 定位京东订单行(page, orderNumber) {
  // 解决：上传入口优先限制在订单所在行，防止页面上其它按钮被误点。
  const 订单文本 = 构建订单文本选择器(orderNumber);
  await page.locator(`text="${订单文本}"`).first().waitFor({ timeout: 60_000 });
  const 表格行 = page.locator(`tr:has-text("${订单文本}")`).first();
  if (await 表格行.count() > 0) {
    return 表格行;
  }
  return page.locator(`text="${订单文本}"`).first();
}

async function 打开京东回传入口(page, orderNumber, 选项 = {}) {
  // 解决：回传入口可能叫回传、上传或登记，找不到就明确暴露页面变化。
  const { onProgress = null, item = { orderNumber } } = 选项;
  await 通知上传阶段(onProgress, item, `正在定位京东订单行：${orderNumber}`, 'find-order-row');
  const 订单行 = await 定位京东订单行(page, orderNumber);
  await 通知上传阶段(onProgress, item, `已找到订单行，正在查找发票回传入口：${orderNumber}`, 'find-return-entry');
  const 回传按钮 = await 等待直到(page, async () => {
    if (await 页面存在京东加载提示(page)) return null;
    return 定位第一个可见元素(订单行, [
      'button:has-text("回传")',
      'a:has-text("回传")',
      'button:has-text("上传发票")',
      'a:has-text("上传发票")',
      'button:has-text("上传")',
      'a:has-text("上传")',
      'button:has-text("登记")',
      'a:has-text("登记")',
      'button:has-text("发票")',
      'a:has-text("发票")',
      'button:has-text("开票")',
      'a:has-text("开票")',
    ]);
  }, {
    timeoutMs: 60_000,
    intervalMs: 500,
    超时消息: `京东后台已找到订单 ${orderNumber}，但没有找到发票回传入口。`,
  });
  await 通知上传阶段(onProgress, item, `已找到发票回传入口，正在打开：${orderNumber}`, 'open-return-entry');
  await 回传按钮.click();
}

async function 读取京东回传字段值(page) {
  // 解决：上传前必须确认京东 OCR 已把必填字段真正填进表单，避免文件刚选中就抢先提交。
  return page.evaluate(() => {
    const 字段标签列表 = ['发票号码', '发票抬头', '发票金额', '销方税号', '销方名称', '开票时间', '发票备注'];
    const 字段值 = {};
    const 元素可见 = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const 读取父级文本 = (element) => {
      const 文本列表 = [];
      let parent = element.parentElement;
      for (let level = 0; level < 8 && parent; level += 1, parent = parent.parentElement) {
        if (['BODY', 'HTML'].includes(parent.tagName)) continue;
        const text = String(parent.innerText || parent.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) 文本列表.push(text);
      }
      return 文本列表;
    };
    const 输入框列表 = Array.from(document.querySelectorAll('input, textarea'));
    for (const 输入框 of 输入框列表) {
      if (!元素可见(输入框)) continue;
      const value = String(输入框.value || '').trim();
      const 父级文本列表 = 读取父级文本(输入框);
      for (const 字段标签 of 字段标签列表) {
        if (字段值[字段标签]) continue;
        const 命中字段 = 父级文本列表.some((text) => text === 字段标签 || text.startsWith(`${字段标签} `));
        if (命中字段) 字段值[字段标签] = value;
      }
    }
    return 字段值;
  });
}

async function 定位京东回传字段输入框(page, 字段标签) {
  // 解决：京东表单字段 id 会变，只按中文标签找到同一行里的真实输入框。
  const 输入框列表 = page.locator('input, textarea');
  const 输入框数量 = await 输入框列表.count();
  for (let 索引 = 0; 索引 < 输入框数量; 索引 += 1) {
    const 输入框 = 输入框列表.nth(索引);
    if (!await 输入框.isVisible().catch(() => false)) continue;
    const 命中字段 = await 输入框.evaluate((element, labelText) => {
      let parent = element.parentElement;
      for (let level = 0; level < 8 && parent; level += 1, parent = parent.parentElement) {
        if (['BODY', 'HTML'].includes(parent.tagName)) continue;
        const text = String(parent.innerText || parent.textContent || '').replace(/\s+/g, ' ').trim();
        if (text === labelText || text.startsWith(`${labelText} `)) return true;
      }
      return false;
    }, 字段标签).catch(() => false);
    if (命中字段) return 输入框;
  }
  return null;
}

async function 补齐京东发票备注(page, 备注文本 = 默认发票备注文本) {
  // 解决：实测国补订单备注为空会被京东拦截，提交前统一补齐可见备注字段。
  const 备注输入框 = await 定位京东回传字段输入框(page, '发票备注');
  if (!备注输入框) return false;
  const 当前备注 = String(await 备注输入框.inputValue().catch(() => '')).trim();
  if (当前备注) return false;
  await 备注输入框.fill(备注文本);
  return true;
}

async function 等待京东发票识别完成(page) {
  // 解决：京东 OCR 识别是异步的，只有必填字段都有值后才允许点击推送。
  const 必填字段列表 = ['发票号码', '发票抬头', '发票金额', '销方税号', '销方名称', '开票时间'];
  return 等待直到(page, async () => {
    const 字段值 = await 读取京东回传字段值(page);
    const 缺失字段列表 = 必填字段列表.filter((字段名) => !String(字段值[字段名] || '').trim());
    if (缺失字段列表.length === 0) {
      return 字段值;
    }
    return null;
  }, {
    timeoutMs: 60_000,
    intervalMs: 500,
    超时消息: '京东回传弹窗已选择文件，但发票识别结果一直没有填完整。请查看截图确认缺少哪个必填字段。',
  });
}

async function 上传发票文件(page, invoiceFilePath, 选项 = {}) {
  // 解决：文件上传只接受已经下载到本机的真实发票文件。
  const { onProgress = null, item = { invoiceFilePath } } = 选项;
  if (!fs.existsSync(invoiceFilePath)) {
    throw new Error(`发票文件不存在，无法回传：${invoiceFilePath}`);
  }

  const 文件输入框 = await 等待直到(page, async () => {
    const input = page.locator('input[type="file"]').first();
    if (await input.count() === 0) return null;
    return input;
  }, {
    timeoutMs: 30_000,
    intervalMs: 500,
    超时消息: '京东回传弹窗没有出现文件选择框，请检查上传入口是否改版。',
  });
  await 文件输入框.setInputFiles(invoiceFilePath);
  await 通知上传阶段(onProgress, item, `正在等待京东识别发票内容：${path.basename(invoiceFilePath)}`, 'wait-recognition');
  await 等待京东发票识别完成(page);
  if (await 补齐京东发票备注(page)) {
    await 通知上传阶段(onProgress, item, '发票备注为空，已按京东要求补齐。', 'fill-remark');
  }

  const 确认按钮 = await 等待直到(page, () => 定位第一个可见可用元素(page, [
    'button:has-text("推送给买家")',
    'button:has-text("确定")',
    'button:has-text("提交")',
    'button:has-text("保存")',
    'a:has-text("确定")',
    'a:has-text("提交")',
  ]), {
    timeoutMs: 60_000,
    intervalMs: 500,
    超时消息: '京东回传弹窗已选择文件，但没有找到可点击的推送或提交按钮。',
  });
  if (!确认按钮) {
    throw new Error('京东回传弹窗已选择文件，但没有找到确定或提交按钮。');
  }
  await 确认按钮.click();
}

async function 读取京东回传提交状态(page, orderNumber = '') {
  // 解决：提交后的成败只看回传抽屉、当前订单行和明确提示，避免被页面其它文案污染。
  const 页面提交状态 = await page.evaluate((订单号) => {
    const 元素可见 = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const 规范文本 = (text) => String(text || '').replace(/\s+/g, ' ').trim();
    const 可见文本列表 = Array.from(document.querySelectorAll('body *'))
      .filter((element) => 元素可见(element))
      .map((element) => 规范文本(element.innerText || element.textContent))
      .filter(Boolean);
    const 抽屉仍打开 = 可见文本列表.some((text) => text === '上传电子发票');
    const 错误文本列表 = 可见文本列表
      .filter((text) => text.length <= 120)
      .filter((text) => /上传失败|回传失败|提交失败|系统错误|操作异常|错误|异常|请输入|不能为空|必填/.test(text));
    const 成功文本列表 = 可见文本列表
      .filter((text) => text.length <= 120)
      .filter((text) => /上传成功|回传成功|推送成功|提交成功|发票上传成功|操作成功/.test(text));
    const 订单行文本列表 = 订单号
      ? Array.from(document.querySelectorAll('tr'))
        .map((element) => 规范文本(element.innerText || element.textContent))
        .filter((text) => text.includes(订单号))
      : [];
    return {
      抽屉仍打开,
      错误文本列表,
      成功文本列表,
      订单行文本列表,
      订单已离开待开票列表: Boolean(订单号) && 订单行文本列表.length === 0,
    };
  }, String(orderNumber || ''));
  const 订单行状态列表 = (页面提交状态.订单行文本列表 || []).map((文本) => 归类发票状态(文本));
  const 订单已开票成功 = 订单行状态列表.includes('success');
  return {
    ...页面提交状态,
    订单行状态列表,
    订单已开票成功,
    订单仍待上传: 订单行状态列表.some((状态) => ['pending', 'failed'].includes(状态)),
  };
}

function 格式化京东回传错误(提交状态) {
  // 解决：失败时只把真实错误提示抛给上层，避免把整页文本塞进报告。
  const 错误文本 = Array.from(new Set(提交状态.错误文本列表 || []))
    .filter((text) => text && !/订单编号|发票抬头|发票金额/.test(text))
    .slice(0, 5)
    .join('；');
  return 错误文本 || '京东回传提交后仍停留在上传弹窗，且没有给出成功结果。';
}

async function 等待京东回传完成(page, orderNumber = '', { 超时Ms = 120_000 } = {}) {
  // 解决：提交后等待真实结果，不再把页面里的无关“成功”文案当成回传完成。
  const 初始提交状态 = await 读取京东回传提交状态(page, orderNumber).catch(() => null);
  const 初始可判定 = 初始提交状态
    && (
      初始提交状态.错误文本列表.length > 0
      || 初始提交状态.成功文本列表.length > 0
      || (orderNumber && 初始提交状态.订单已开票成功 && !初始提交状态.抽屉仍打开)
      || (orderNumber && 初始提交状态.订单已离开待开票列表 && !初始提交状态.抽屉仍打开)
      || (!orderNumber && !初始提交状态.抽屉仍打开)
    );
  const 初始等待结果 = 初始可判定 ? 'state-ready' : await 等待直到(page, async () => {
    if (await 页面存在京东加载提示(page)) return 'loading';
    const 提交状态 = await 读取京东回传提交状态(page, orderNumber);
    if (提交状态.错误文本列表.length > 0 || 提交状态.成功文本列表.length > 0) return 'state-ready';
    if (orderNumber && 提交状态.订单已开票成功 && !提交状态.抽屉仍打开) return 'state-ready';
    if (orderNumber && 提交状态.订单已离开待开票列表 && !提交状态.抽屉仍打开) return 'state-ready';
    if (!orderNumber && !提交状态.抽屉仍打开) return 'state-ready';
    return null;
  }, {
    timeoutMs: 8_000,
    intervalMs: 200,
    超时消息: '提交后没有观察到京东加载遮罩或结果变化。',
  }).catch(() => {});
  if (初始等待结果 === 'loading') {
    await 等待京东页面停止加载(page);
  }
  let 上次列表刷新时间 = 0;
  const 最终提交状态 = await 等待直到(page, async () => {
    const 提交状态 = await 读取京东回传提交状态(page, orderNumber);
    if (提交状态.错误文本列表.length > 0) {
      return { status: 'error', 提交状态 };
    }
    if (提交状态.成功文本列表.length > 0) {
      return { status: 'success', 提交状态 };
    }
    if (orderNumber && 提交状态.订单已开票成功 && !提交状态.抽屉仍打开) {
      return { status: 'success', 提交状态 };
    }
    if (orderNumber && 提交状态.订单已离开待开票列表 && !提交状态.抽屉仍打开) {
      return { status: 'success', 提交状态 };
    }
    if (!orderNumber && !提交状态.抽屉仍打开) {
      return { status: 'success', 提交状态 };
    }
    // 解决：上传成功后京东列表不会自动刷新，抽屉已关闭但订单行仍显示待开票时，
    // 每隔几秒重新点击“查询”按钮刷新列表，才能拿到京东返回的开票结果。
    const 现在 = Date.now();
    if (orderNumber
      && !提交状态.抽屉仍打开
      && 提交状态.订单行文本列表.length > 0
      && 提交状态.订单仍待上传
      && 现在 - 上次列表刷新时间 >= 3_000
      && !(await 页面存在京东加载提示(page))) {
      上次列表刷新时间 = 现在;
      await 重新查询京东订单列表(page, orderNumber).catch(() => {});
    }
    return null;
  }, {
    timeoutMs: 超时Ms,
    intervalMs: 1000,
    超时消息: '等待京东确认发票回传成功超时，请在打开的京东页面核对是否已上传。',
  });
  if (最终提交状态.status === 'error') {
    throw new Error(`京东回传失败：${格式化京东回传错误(最终提交状态.提交状态)}`);
  }
}

async function 回传发票到京东({
  店铺配置,
  orderNumber,
  invoiceFilePath,
  headless = true,
  允许人工登录 = !headless,
  凭证批次目录 = '',
}) {
  // 解决：复用京东店铺登录态，打开订单列表并把诺诺下载的发票上传回当前订单。
  await 执行京东回传会话({
    店铺配置,
    invoiceUploads: [{ orderNumber, invoiceFilePath }],
    headless,
    允许人工登录,
    凭证批次目录,
  });
}

function 规范化上传清单(invoiceUploads) {
  // 解决：空清单仍要进入京东核对会话；非空条目必须具备确定的订单与文件映射。
  return (Array.isArray(invoiceUploads) ? invoiceUploads : [])
    .map((item) => {
      const 上传条目 = {
        key: String(item?.key || '').trim(),
        orderNumber: String(item?.orderNumber || '').trim(),
        invoiceFilePath: String(item?.invoiceFilePath || '').trim(),
      };
      if (!上传条目.orderNumber || !上传条目.invoiceFilePath) {
        throw new Error('批量回传京东失败：上传清单缺少订单号或发票文件。');
      }
      return 上传条目;
    });
}

function 构建回传截图路径(店铺配置, item, 状态文本, 选项 = {}) {
  // 解决：每张发票单独生成截图凭证路径，方便回传报告逐单打开。
  const 目标目录 = 选项.凭证批次目录 || 截图目录;
  const 店铺标识 = 规范化店铺标识(店铺配置.id || 店铺配置.name);
  const 店铺名称 = 规范化凭证名称(店铺配置.name || 店铺标识, 店铺标识);
  const 订单号 = String(item.orderNumber || '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-');
  const 结果状态 = 状态文本 === 'success' ? '成功' : 状态文本 === 'error' ? '失败' : 规范化凭证名称(状态文本, '结果');
  const 文件名 = `invoice-return-${店铺标识}-${店铺名称}-${订单号}-${格式化凭证时间()}-${结果状态}.png`;
  return path.join(目标目录, 文件名);
}

async function 保存回传截图(page, 店铺配置, item, 状态文本, 选项 = {}) {
  // 解决：上传结果以京东页面截图为凭证，前端通过截图接口查看。
  const 截图路径 = 构建回传截图路径(店铺配置, item, 状态文本, 选项);
  fs.mkdirSync(path.dirname(截图路径), { recursive: true });
  await page.screenshot({ path: 截图路径, fullPage: true });
  return 验证凭证文件(截图路径);
}

async function 执行京东回传会话({
  店铺配置,
  invoiceUploads,
  headless = true,
  允许人工登录 = !headless,
  continueOnItemError = false,
  需要可见浏览器处理方法 = null,
  onUploadStart = null,
  onUploadProgress = null,
  onUploaded = null,
  onUploadFailed = null,
  凭证批次目录 = '',
  页面保留模式 = 'close',
}) {
  // 解决：同一家京东店铺共用一次登录和浏览器会话；没有文件时也打开并保留页面供核对。
  const 上传清单 = 规范化上传清单(invoiceUploads);
  await 关闭店铺浏览器上下文(店铺配置.id);
  const context = await 创建店铺浏览器上下文({
    headless,
    店铺标识: 店铺配置.id,
    启动地址: 店铺配置.targetUrl,
  });
  注册浏览器上下文(context, {
    店铺名称: 店铺配置.name,
    店铺标识: 店铺配置.id,
  });
  const page = await 打开目标页面(context, 店铺配置.targetUrl);
  try {
    打印日志('发票回传', '京东上传', `打开京东后台：${店铺配置.name}`);
    await 进入消费者发票页面(page, {
      允许人工登录,
      店铺配置,
      目标地址: 店铺配置.targetUrl,
    });
    await 保存店铺浏览器登录态(context, context.__storeAuthStatePath);
    if (上传清单.length === 0) {
      打印日志('发票回传', '京东上传', `当前没有可上传发票，京东页面仅供核对：${店铺配置.name}`);
    }
    for (const [索引, item] of 上传清单.entries()) {
      if (索引 > 0) {
        await page.goto(店铺配置.targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      }
      打印日志('发票回传', '京东上传', `开始上传第 ${索引 + 1}/${上传清单.length} 张发票：${店铺配置.name} ${item.orderNumber}`);
      if (typeof onUploadStart === 'function') {
        await onUploadStart(item);
      }
      try {
        await 通知上传阶段(onUploadProgress, item, `正在查询京东订单：${item.orderNumber}`, 'search-order');
        await 切到京东全部发票列表(page);
        await 查询京东订单(page, item.orderNumber);
        await 通知上传阶段(onUploadProgress, item, `正在等待京东列表加载完成：${item.orderNumber}`, 'wait-list-ready');
        await 等待京东页面停止加载(page);
        const 订单状态 = await 等待京东订单查询结果(page, item.orderNumber);
        if (!订单状态.found) {
          throw new Error(`京东后台全部列表没有找到订单 ${item.orderNumber}，无法判断是否已开票或需要上传。`);
        }
        if (订单状态.alreadyInvoiced) {
          await 通知上传阶段(onUploadProgress, item, `订单 ${item.orderNumber} 已在京东全部列表显示开票成功，无需重复上传。`, 'already-invoiced');
          const screenshotPath = await 保存回传截图(page, 店铺配置, item, 'success', { 凭证批次目录 });
          if (typeof onUploaded === 'function') {
            await onUploaded({
              ...item,
              screenshotPath,
              alreadyInvoiced: true,
              invoiceStatusKind: 订单状态.invoiceStatusKind,
              invoiceBackendRowText: 订单状态.rowText,
            });
          }
          打印日志('发票回传', '京东上传', `京东已开票，无需重复上传：${店铺配置.name} ${item.orderNumber}`);
          continue;
        }
        await 打开京东回传入口(page, item.orderNumber, {
          onProgress: onUploadProgress,
          item,
        });
        await 通知上传阶段(onUploadProgress, item, `正在选择发票文件：${path.basename(item.invoiceFilePath)}`, 'select-file');
        await 上传发票文件(page, item.invoiceFilePath, {
          onProgress: onUploadProgress,
          item,
        });
        await 通知上传阶段(onUploadProgress, item, `正在等待京东确认回传结果：${item.orderNumber}`, 'wait-upload-result');
        await 等待京东回传完成(page, item.orderNumber);
        await 通知上传阶段(onUploadProgress, item, `正在保存回传截图凭证：${item.orderNumber}`, 'save-evidence');
        const screenshotPath = await 保存回传截图(page, 店铺配置, item, 'success', { 凭证批次目录 });
        if (typeof onUploaded === 'function') {
          await onUploaded({ ...item, screenshotPath });
        }
      } catch (错误) {
        if (typeof 需要可见浏览器处理方法 === 'function' && 需要可见浏览器处理方法(错误)) {
          打印日志('发票回传', '京东上传', `需要打开可见浏览器继续处理：${店铺配置.name} ${item.orderNumber}；原因=${错误.message}`);
          throw 错误;
        }
        const screenshotPath = await 保存回传截图(page, 店铺配置, item, 'error', { 凭证批次目录 });
        if (typeof onUploadFailed === 'function') {
          await onUploadFailed({ ...item, screenshotPath }, 错误);
        }
        if (!continueOnItemError) {
          throw 错误;
        }
        打印日志('发票回传', '京东上传', `单张回传失败，继续后续订单：${店铺配置.name} ${item.orderNumber}；原因=${错误.message}`);
        continue;
      }
      打印日志('发票回传', '京东上传', `京东回传完成：${店铺配置.name} ${item.orderNumber}`);
    }
  } finally {
    if (页面保留模式 === 'keep') {
      // 保留页面：回传完成后不自动关闭，供人工核对；程序退出时由关闭全部浏览器上下文统一回收。
      await page.bringToFront().catch(() => {});
      打印日志('发票回传', '京东上传', `京东页面保持打开供核对：${店铺配置.name}`);
    } else {
      await context.close();
    }
  }
}

module.exports = {
  回传发票到京东,
  执行京东回传会话,
  页面存在京东加载提示,
  等待京东页面停止加载,
  切到京东全部发票列表,
  定位订单查询输入框,
  查询京东订单,
  读取京东订单回传前状态,
  等待京东订单查询结果,
  打开京东回传入口,
  读取京东回传字段值,
  补齐京东发票备注,
  等待京东发票识别完成,
  上传发票文件,
  读取京东回传提交状态,
  等待京东回传完成,
  构建回传截图路径,
  规范化上传清单,
};
