const fs = require('fs');
const path = require('path');
const { 打印日志 } = require('../common/logger');
const { 运行目录 } = require('../common/paths');
const { 限时等待 } = require('./dynamicWait');

const 轮询间隔毫秒 = 1000;
const 切店超时毫秒 = 120000;

// 2026-09-20 issues/009：店铺身份读取失败的真因未知，不许猜选择器，先把成功/失败两种 DOM 各留一份现场。
// 每个进程最多写一次（成功样本一份、失败现场一份），分析完即删，不累积垃圾。
const 身份现场状态 = { 已写成功样本: false, 已写失败现场: false };

async function 采集店铺身份现场(page, 错误) {
  const 现场 = {
    记录时间: new Date().toISOString(),
    错误: String((错误 && 错误.message) || 错误 || ''),
    页面地址: typeof page?.url === 'function' ? page.url() : '',
    页签信息: [],
  };
  try {
    const 上下文 = typeof page?.context === 'function' ? page.context() : null;
    const 页面列表 = 上下文 && typeof 上下文.pages === 'function' ? 上下文.pages() : [];
    现场.页签数 = 页面列表.length;
    现场.页签信息 = 页面列表.map((item) => {
      try { return item.url(); } catch (_错误) { return '读取失败'; }
    });
  } catch (_错误) { 现场.页签数 = '读取失败'; }
  try {
    const 头部 = page.locator('.headerShopName').first();
    现场.头部 = await 限时等待(头部.evaluate((element) => ({
      可见: !!element.offsetParent,
      文本: String(element.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
      mask节点数: element.querySelectorAll('[data-bytereplay-mask="true"]').length,
      label列表: [...element.querySelectorAll('[label]')].slice(0, 20).map((el) => `${el.getAttribute('label')}=${el.getAttribute('value')}`),
      外部HTML: String(element.outerHTML || '').slice(0, 20000),
    })), { 超时毫秒: 5000, 说明: '抖音店铺头部求值' });
  } catch (错误2) {
    现场.头部 = `读取失败：${(错误2 && 错误2.message) || 错误2}`;
  }
  return 现场;
}

function 写身份现场文件(文件名, 现场) {
  try {
    fs.mkdirSync(运行目录, { recursive: true });
    fs.writeFileSync(path.join(运行目录, 文件名), JSON.stringify(现场, null, 2), 'utf8');
  } catch (_错误) {
    // 现场落盘本身不许影响主流程。
  }
}

async function 记录店铺身份成功样本(page) {
  if (身份现场状态.已写成功样本) return;
  身份现场状态.已写成功样本 = true;
  写身份现场文件('douyin-store-identity-ok.json', await 采集店铺身份现场(page, null));
}

async function 记录店铺身份失败现场(page, 错误) {
  if (身份现场状态.已写失败现场) return;
  身份现场状态.已写失败现场 = true;
  写身份现场文件('douyin-store-identity-fail.json', await 采集店铺身份现场(page, 错误));
}

// 解决：从隔壁项目 12.店铺指标数据自动更新 照抄成熟切店方案，适配本项目持久化浏览器模型。
function 规范化抖音店铺名(value) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function 解析期望店铺身份(店铺配置) {
  // 解决：同手机号多店靠 platformStoreId + platformStoreName 精确切店。
  const storeId = String(店铺配置?.platformStoreId || 店铺配置?.platformStoreID || '').replace(/\D/g, '').trim();
  // 优先用平台店铺名，其次用本地 name 去掉前缀编号。
  const rawName = String(店铺配置?.platformStoreName || 店铺配置?.platformStoreNameFull || '').trim();
  const fallbackName = String(店铺配置?.name || '').replace(/^抖音店铺\d+\s*/,'').trim();
  const storeName = rawName || fallbackName;
  if (!storeId || !storeName) {
    throw new Error(
      `抖音店铺「${店铺配置?.name || 店铺配置?.id || '未知店铺'}」尚未配置平台店铺ID和名称，请在 data/stores.json 补充 platformStoreId / platformStoreName。当前 name=${storeName} id=${storeId}`
    );
  }
  return { storeId, storeName };
}

function 店铺身份是否一致(实际, 期望) {
  return String(实际?.storeId || '') === String(期望?.storeId || '') &&
    规范化抖音店铺名(实际?.storeName) === 规范化抖音店铺名(期望?.storeName);
}

async function 读取抖音店铺名(shopHeader) {
  const candidates = shopHeader.locator(':scope > [data-bytereplay-mask="true"]');
  const visible = [];
  for (let i = 0; i < await candidates.count(); i += 1) {
    const c = candidates.nth(i);
    if (await c.isVisible().catch(() => false)) visible.push(c);
  }
  if (visible.length !== 1) {
    throw new Error(`读取抖音当前店铺名称失败：顶部识别到 ${visible.length} 个可见纯店名节点。`);
  }
  const name = (await visible[0].innerText()).replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('读取抖音当前店铺名称失败：顶部纯店名为空。');
  return name;
}

async function 查找可见切店入口(page) {
  const entries = page.getByText('切换组织/店铺', { exact: true });
  const visible = [];
  for (let i = 0; i < await entries.count(); i += 1) {
    const e = entries.nth(i);
    if (await e.isVisible().catch(() => false)) visible.push(e);
  }
  return visible;
}

async function 等待唯一可见切店入口(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let visible = [];
  while (Date.now() <= deadline) {
    visible = await 查找可见切店入口(page);
    if (visible.length === 1) return visible[0];
    if (visible.length > 1) break;
    await page.waitForTimeout(轮询间隔毫秒);
  }
  throw new Error(`抖音切店入口不唯一：识别到 ${visible.length} 个可见“切换组织/店铺”。`);
}

async function 确保店铺菜单打开不处理弹窗(page, existingShopHeader = null) {
  const visible = await 查找可见切店入口(page);
  if (visible.length === 1) return visible[0];
  if (visible.length > 1) throw new Error(`抖音切店入口不唯一：识别到 ${visible.length} 个可见“切换组织/店铺”。`);
  const shopHeader = existingShopHeader || page.locator('.headerShopName').first();
  await shopHeader.waitFor({ state: 'visible', timeout: 15000 });
  await shopHeader.click({ timeout: 5000 });
  return 等待唯一可见切店入口(page);
}

async function 读取当前抖音店铺ID(page, shopHeader, timeoutMs = 10000) {
  // 当前身份来自顶部店铺信息的结构化 label/value；切店按钮只属于身份不一致后的切店动作。
  const 读取ID列表 = async () => {
    const candidates = shopHeader.locator(':scope [label="店铺ID"][value]');
    const ids = [];
    for (let i = 0; i < await candidates.count(); i += 1) {
      const value = String(await candidates.nth(i).getAttribute('value') || '').trim();
      if (value) ids.push(value);
    }
    return [...new Set(ids)];
  };

  let ids = await 读取ID列表();
  if (ids.length === 0) {
    await page.locator('button:has-text("我知道了")').first().click({ timeout: 1500 }).catch(() => {});
    await shopHeader.click({ timeout: 5000 });
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    ids = await 读取ID列表();
    if (ids.length === 1 && /^\d+$/.test(ids[0])) return ids[0];
    if (ids.length > 1 || (ids.length === 1 && !/^\d+$/.test(ids[0]))) break;
    await page.waitForTimeout(轮询间隔毫秒);
  }
  throw new Error(`读取抖音当前店铺 ID 失败：顶部店铺信息识别到 ${ids.length} 个有效店铺 ID。`);
}

async function 点击切店入口(page, 选项 = {}) {
  // 解决：切店弹层会“动画中/刚收起”导致一次扫描到的入口在点击时已失效（Playwright: element is not stable → not visible）。
  // 因此每次尝试都重新解析入口，失败就重开店铺菜单再试，而不是把一次性扫描到的元素直接点到底。
  const 最大尝试次数 = Math.max(1, Number(选项.最大尝试次数) || 3);
  let 最近错误 = null;
  for (let 尝试 = 1; 尝试 <= 最大尝试次数; 尝试 += 1) {
    try {
      const entry = await 确保店铺菜单打开不处理弹窗(page);
      await entry.click({ timeout: 5000, noWaitAfter: true });
      return;
    } catch (error) {
      最近错误 = error;
      const 首行 = String(error?.message || error).split('\n')[0];
      打印日志('抖音登录', '切店', `第 ${尝试}/${最大尝试次数} 次点击「切换组织/店铺」未成功：${首行}；重新解析切店入口`);
      await page.waitForTimeout(500);
    }
  }
  throw 最近错误 || new Error('抖音切店入口点击失败：多次尝试后仍未成功。');
}

async function 读取当前抖音店铺身份(page, 选项 = {}) {
  // 解决（issues/009）：轮询读取时必须能用更短的超时，否则多页签/多轮询时一层层叠加成大卡顿。
  const { 头部等待毫秒 = 15000, 编号等待毫秒 = 10000, 记录现场 = true } = 选项;
  const shopHeader = page.locator('.headerShopName').first();
  try {
    await shopHeader.waitFor({ state: 'visible', timeout: 头部等待毫秒 });
    const storeName = await 读取抖音店铺名(shopHeader);
    const storeId = await 读取当前抖音店铺ID(page, shopHeader, 编号等待毫秒);
    await 记录店铺身份成功样本(page);
    return { storeId, storeName };
  } catch (错误) {
    if (记录现场) await 记录店铺身份失败现场(page, 错误);
    throw 错误;
  }
}

async function 查找精确店铺选项(page, 期望) {
  const candidates = page.getByText(期望.storeName, { exact: true });
  const visible = [];
  for (let i = 0; i < await candidates.count(); i += 1) {
    const c = candidates.nth(i);
    if (!await c.isVisible().catch(() => false) || await c.isDisabled().catch(() => false)) continue;
    visible.push(c);
  }
  return visible.length === 1 ? visible[0] : null;
}

async function 跨页查找精确店铺选项(originPage, 期望, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    for (const p of originPage.context().pages()) {
      const opt = await 查找精确店铺选项(p, 期望);
      if (opt) return { page: p, option: opt };
    }
    await originPage.waitForTimeout(轮询间隔毫秒);
  }
  return null;
}

async function 点击店铺选项(option, surface = null) {
  await option.click({ timeout: 10000 });
}

async function 等待目标店铺(originPage, 期望, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() <= deadline) {
    for (const p of originPage.context().pages()) {
      // 解决（issues/009）：内层逐页循环也要看截止时间，否则页签一多单轮就拖出几分钟。
      if (Date.now() > deadline) break;
      const header = p.locator('.headerShopName').first();
      if ((await header.count()) === 0 || !await header.isVisible().catch(() => false)) continue;
      try {
        last = await 读取当前抖音店铺身份(p, { 头部等待毫秒: 5000, 编号等待毫秒: 5000, 记录现场: true });
        if (店铺身份是否一致(last, 期望)) return { page: p, identity: last };
      } catch (_e) {}
    }
    await originPage.waitForTimeout(轮询间隔毫秒);
  }
  const actual = last ? `${last.storeName}(${last.storeId})` : '未读取到';
  throw new Error(`等待抖音目标店铺超时：目标=${期望.storeName}(${期望.storeId})，当前=${actual}。`);
}

async function 确保抖音目标店铺(page, 店铺配置, 报告进度, 选项 = {}) {
  const 期望 = 解析期望店铺身份(店铺配置);
  const 当前 = await 读取当前抖音店铺身份(page);
  if (店铺身份是否一致(当前, 期望)) return { page, identity: 当前 };
  if (typeof 报告进度 === 'function') 报告进度('切换抖音店铺', `当前=${当前.storeName}(${当前.storeId})，目标=${期望.storeName}(${期望.storeId})`);
  else 打印日志('抖音登录', '切店', `当前=${当前.storeName}(${当前.storeId})，目标=${期望.storeName}(${期望.storeId})`);
  await 点击切店入口(page);
  await page.waitForTimeout(轮询间隔毫秒);
  const found = await 跨页查找精确店铺选项(page, 期望);
  if (found) {
    await 点击店铺选项(found.option, page);
  } else {
    if (typeof 报告进度 === 'function') 报告进度('等待人工切店', '未找到目标完整店名的唯一可点项，请在当前页面手动切换，程序会自动续跑');
    else 打印日志('抖音登录', '切店', '未找到目标店铺的唯一可点项，请手动切换，程序将等待...');
    await page.bringToFront().catch(() => {});
  }
  const timeoutMs = Number(选项.storeSwitchTimeoutMs) || 切店超时毫秒;
  return 等待目标店铺(page, 期望, timeoutMs);
}

module.exports = {
  规范化抖音店铺名,
  解析期望店铺身份,
  店铺身份是否一致,
  读取抖音店铺名,
  读取当前抖音店铺ID,
  读取当前抖音店铺身份,
  查找可见切店入口,
  等待唯一可见切店入口,
  点击切店入口,
  查找精确店铺选项,
  跨页查找精确店铺选项,
  点击店铺选项,
  等待目标店铺,
  确保抖音目标店铺,
};
