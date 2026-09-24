// 人工登录助手：打开抖音店铺浏览器并停在登录页，等用户完成短信验证码登录；
// 检测到登录成功后打印结果退出（登录态保存在账号资料目录，进程退出不影响）。
// 用法：node .codex-temporary/抖音登录助手.js
const path = require('path');
const 项目 = path.resolve(__dirname, '..', '6.抖音发票回传');
const { 创建抖音账号浏览器上下文 } = require(path.join(项目, 'src/browser/douyinBrowserContext'));
const { 读取店铺配置 } = require(path.join(项目, 'src/store/storeConfigService'));

const 店铺 = (读取店铺配置().stores || []).find((s) => s.id === 'douyin-store-2') || 读取店铺配置().stores[0];

function 是登录页(url) {
  try {
    const u = new URL(String(url || ''));
    return u.hostname === 'fxg.jinritemai.com' && u.pathname.startsWith('/login');
  } catch {
    return true;
  }
}

(async () => {
  const context = await 创建抖音账号浏览器上下文(店铺, { headless: false });
  const page = context.pages().find((p) => !p.isClosed()) || await context.newPage();
  await page.goto('https://fxg.jinritemai.com/ffa/morder/receipt/list', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', e.message));
  await page.bringToFront().catch(() => {});
  console.log(`店铺=${店铺.name}｜当前URL=${page.url()}`);
  const 截止 = Date.now() + 240 * 60 * 1000;
  while (Date.now() < 截止) {
    try {
      await page.waitForTimeout(5000);
    } catch (e) {
      console.log('浏览器窗口被关闭，退出等待。');
      process.exit(2);
    }
    if (page.isClosed()) { console.log('浏览器窗口被关闭，退出等待。'); process.exit(2); }
    const url = page.url();
    if (!是登录页(url)) {
      console.log('抖音已登录，当前URL=' + url);
      console.log('提示：浏览器保持打开，登录态已写入账号资料目录。');
      process.exit(0);
    }
  }
  console.log('等待人工登录超时（240分钟）。');
  process.exit(2);
})().catch((e) => { console.error('异常：' + (e && e.stack || e)); process.exit(1); });
