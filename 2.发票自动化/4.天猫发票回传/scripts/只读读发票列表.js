// 只读：打开天猫发票后台「待回传」页，整页正文 + 截图落盘，供人工逐条看备注/对账。
// 铁律：只读——不点提交/同意/回传（**「待同意」绝不点同意**），不填表单。
// 用法：node scripts/只读读发票列表.js [店铺id]
const fs = require('fs');
const path = require('path');
const { 初始化运行目录, 确保目录存在 } = require('../src/common/fs');
const { 运行目录 } = require('../src/common/paths');
const { 获取指定或首个启用店铺 } = require('../src/store/storeConfigService');
const { 创建天猫店铺浏览器上下文, 获取或打开天猫页面 } = require('../src/browser/tmallBrowserContext');
const { 读取天猫业务后台地址 } = require('../src/browser/tmallBusinessUrl');
const { 打开天猫待回传发票页面 } = require('../src/invoiceReturn/tmallInvoicePage');

async function main() {
  const 店铺 = 获取指定或首个启用店铺(process.argv[2] || '');
  初始化运行目录();
  const 时间戳 = new Date().toISOString().replace(/[:.]/g, '-');
  const 输出目录 = path.join(运行目录, `只读读票-${时间戳}`);
  确保目录存在(输出目录);
  console.log(`[只读] 店铺=${店铺.id} 输出目录=${输出目录}`);

  const context = await 创建天猫店铺浏览器上下文(店铺, { headless: false });
  try {
    const page = await 获取或打开天猫页面(context, 读取天猫业务后台地址(店铺));
    await 打开天猫待回传发票页面(page, 店铺);
    const 正文 = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    fs.writeFileSync(path.join(输出目录, `${店铺.id}-正文.txt`), 正文, 'utf8');
    await page.screenshot({ path: path.join(输出目录, `${店铺.id}-页面.png`) });
    console.log(`[只读] url=${page.url()}`);
    console.log(`[只读] 正文长度=${正文.length}，已落盘：${店铺.id}-正文.txt / ${店铺.id}-页面.png`);
    console.log('----- 正文前 1200 字 -----');
    console.log(正文.slice(0, 1200));
  } finally {
    await context.close();
  }
}

main().catch((错误) => {
  console.log('[只读] 失败：' + (错误 && 错误.message ? 错误.message : 错误));
  process.exitCode = 1;
});
