const fs = require('fs');
const path = require('path');
const { 初始化运行目录, 确保目录存在 } = require('../common/fs');
const { 运行目录 } = require('../common/paths');
const { 打印日志 } = require('../common/logger');
const { 获取指定或首个启用店铺 } = require('../store/storeConfigService');
const { 创建抖音店铺浏览器上下文, 获取或打开抖音页面 } = require('../browser/douyinBrowserContext');
const { 读取抖音业务后台地址 } = require('../browser/douyinBusinessUrl');
const { 打开抖音待回传发票页面 } = require('../invoiceReturn/douyinInvoicePage');

const 抖音元素采集目录 = path.join(运行目录, 'douyin-element-collection');

async function 采集抖音页面快照(page) {
  // 解决：采集真实页面控件结构，后续改选择器时有据可查。
  return page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const shortText = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const describe = (element) => ({
      tag: element.tagName.toLowerCase(),
      text: shortText(element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.value || ''),
      id: element.id || '',
      type: element.getAttribute('type') || '',
      placeholder: element.getAttribute('placeholder') || '',
      role: element.getAttribute('role') || '',
      testid: element.getAttribute('data-testid') || '',
      className: String(element.className || '').slice(0, 160),
    });
    return {
      url: location.href,
      title: document.title,
      bodyTextSample: shortText(document.body?.innerText || '').slice(0, 2000),
      inputs: Array.from(document.querySelectorAll('input')).filter(visible).map(describe),
      buttons: Array.from(document.querySelectorAll('button,a')).filter(visible).map(describe).slice(0, 160),
      fileInputs: Array.from(document.querySelectorAll('input[type="file"]')).map(describe),
    };
  });
}

function 构建采集文件路径(店铺配置) {
  // 解决：每次采集按店铺和时间落盘，便于对照 issue 记录。
  const safeStoreId = String(店铺配置.id || 'douyin-store').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-');
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeStoreId}.json`;
  return path.join(抖音元素采集目录, fileName);
}

async function 采集单个抖音店铺元素(店铺配置, 选项 = {}) {
  // 解决：打开指定店铺业务页并采集消费者开票页真实控件。
  const { headless = false } = 选项;
  初始化运行目录();
  确保目录存在(抖音元素采集目录);
  const context = await 创建抖音店铺浏览器上下文(店铺配置, { headless });
  try {
    const page = await 获取或打开抖音页面(context, 读取抖音业务后台地址(店铺配置));
    await 打开抖音待回传发票页面(page, 店铺配置);
    const snapshot = await 采集抖音页面快照(page);
    const filePath = 构建采集文件路径(店铺配置);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    打印日志('抖音元素采集', '页面快照', `已保存：${filePath}`);
    return { filePath, snapshot };
  } finally {
    // 浏览器保持打开，供人工核实；用户看完手动关闭窗口即可。
  }
}

async function 采集首个或指定抖音店铺元素(storeId = '', 选项 = {}) {
  // 解决：命令行采集入口支持默认店铺和指定店铺。
  const 店铺配置 = 获取指定或首个启用店铺(storeId);
  return 采集单个抖音店铺元素(店铺配置, 选项);
}

module.exports = {
  抖音元素采集目录,
  采集抖音页面快照,
  构建采集文件路径,
  采集单个抖音店铺元素,
  采集首个或指定抖音店铺元素,
};
