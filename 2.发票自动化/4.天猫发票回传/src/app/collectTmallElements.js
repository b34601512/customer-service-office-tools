const fs = require('fs');
const path = require('path');
const { 初始化运行目录, 确保目录存在 } = require('../common/fs');
const { 数据目录 } = require('../common/paths');
const { 打印日志 } = require('../common/logger');
const { 获取指定或首个启用店铺 } = require('../store/storeConfigService');
const { 创建天猫店铺浏览器上下文, 获取或打开天猫页面 } = require('../browser/tmallBrowserContext');
const { 是天猫业务页面, 等待天猫登录完成 } = require('../browser/tmallAuthenticatedPage');
const { 天猫默认业务后台地址, 读取天猫业务后台地址 } = require('../browser/tmallBusinessUrl');

const 元素采集报告路径 = path.join(数据目录, 'element-collection-latest.json');

function 提取候选控件文本(text) {
  // 解决：采集报告只保留短文本控件，避免把整页内容塞进报告。
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

async function 读取天猫页面元素快照(page) {
  // 解决：元素采集一次性在页面内读取，避免跨进程逐个 locator 读取导致很慢。
  return page.evaluate(() => {
    const 可见 = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const 短文本 = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const 控件选择器 = 'button,a,input,textarea,[role="button"],[role="menuitem"]';
    return {
      url: location.href,
      title: document.title,
      pageTextSample: 短文本(document.body?.innerText || ''),
      iframes: Array.from(document.querySelectorAll('iframe')).slice(0, 30).map((frame) => ({
        id: frame.id || '',
        name: frame.name || '',
        src: frame.src || '',
        visible: 可见(frame),
      })),
      controls: Array.from(document.querySelectorAll(控件选择器))
        .filter(可见)
        .slice(0, 200)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          text: 短文本(element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('placeholder') || ''),
          id: element.id || '',
          name: element.getAttribute('name') || '',
          type: element.getAttribute('type') || '',
          role: element.getAttribute('role') || '',
          placeholder: element.getAttribute('placeholder') || '',
          href: element.getAttribute('href') || '',
          className: String(element.className || '').slice(0, 160),
        })),
    };
  });
}

async function 搜索天猫发票入口(page) {
  // 解决：先采集页面内和链接里的发票入口候选，不猜天猫后台具体路径。
  return page.evaluate(() => {
    const 可见 = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const 短文本 = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    return Array.from(document.querySelectorAll('a,button,[role="button"],[role="menuitem"]'))
      .filter(可见)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: 短文本(element.innerText || element.textContent || element.getAttribute('aria-label') || ''),
        href: element.getAttribute('href') || '',
        id: element.id || '',
        className: String(element.className || '').slice(0, 160),
      }))
      .filter((item) => /发票|开票|票据|财务|订单|待处理|回传|上传/.test(`${item.text} ${item.href}`))
      .slice(0, 80);
  });
}

function 写入元素采集报告(report) {
  // 解决：采集事实落盘，后续实现回传流程不依赖短上下文记忆。
  确保目录存在(path.dirname(元素采集报告路径));
  fs.writeFileSync(元素采集报告路径, JSON.stringify(report, null, 2), 'utf8');
}

async function 采集单个天猫店铺元素(店铺配置, 选项 = {}) {
  // 解决：打开已登录店铺后台，只读采集控件和发票入口候选；采集完浏览器保持打开供人工核对。
  const { headless = false } = 选项;
  初始化运行目录();
  const context = await 创建天猫店铺浏览器上下文(店铺配置, { headless });
  const 业务后台地址 = 读取天猫业务后台地址(店铺配置);
  const page = await 获取或打开天猫页面(context, 业务后台地址);
  await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => {});
  await page.bringToFront().catch(() => {});
  if (!是天猫业务页面(page.url())) {
    await 等待天猫登录完成(page, 店铺配置);
    await page.goto(业务后台地址, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  if (!是天猫业务页面(page.url())) {
    throw new Error(`当前店铺还没有进入天猫业务后台，请先完成登录。当前地址：${page.url()}`);
  }
  const pageSnapshot = await 读取天猫页面元素快照(page);
  const invoiceEntryCandidates = await 搜索天猫发票入口(page);
  const report = {
    storeId: 店铺配置.id,
    storeName: 店铺配置.name,
    collectedAt: new Date().toISOString(),
    pageSnapshot,
    invoiceEntryCandidates,
    reportPath: 元素采集报告路径,
  };
  写入元素采集报告(report);
  打印日志('元素采集', '天猫后台', `已保存采集报告：${元素采集报告路径}（浏览器保持打开供你核对）`);
  return report;
}

async function 采集首个或指定天猫店铺元素(storeId = '', 选项 = {}) {
  // 解决：命令行采集默认使用第一家启用店铺。
  const 店铺配置 = 获取指定或首个启用店铺(storeId);
  return 采集单个天猫店铺元素(店铺配置, 选项);
}

module.exports = {
  元素采集报告路径,
  天猫默认业务后台地址,
  读取天猫业务后台地址,
  提取候选控件文本,
  读取天猫页面元素快照,
  搜索天猫发票入口,
  写入元素采集报告,
  采集单个天猫店铺元素,
  采集首个或指定天猫店铺元素,
};
