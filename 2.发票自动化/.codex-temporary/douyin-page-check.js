// 只读：打开抖音「消费者申请开票记录」页，数一遍订单 + 截屏存证（不导出、不回传、不提交）。
// 用法：node .codex-temporary/douyin-page-check.js [douyin-store-1|douyin-store-2] [标签名：待开票|已开票|全部]
const path = require('path');
const base = path.resolve(__dirname, '..', '6.抖音发票回传');

const { 读取店铺配置 } = require(path.join(base, 'src/store/storeConfigService'));
const { 创建抖音账号浏览器上下文 } = require(path.join(base, 'src/browser/douyinBrowserContext'));
const {
  打开抖音待回传发票页面,
  读取当前页待回传订单,
  读取抖音可见提示文本列表,
} = require(path.join(base, 'src/invoiceReturn/douyinInvoicePage'));

async function main() {
  const 目标店铺 = process.argv[2] || 'douyin-store-2';
  const 原始配置 = 读取店铺配置();
  const 全部店铺 = Array.isArray(原始配置) ? 原始配置 : (原始配置.stores || []);
  const 店铺 = 全部店铺.find((s) => s.id === 目标店铺);
  if (!店铺) throw new Error(`找不到店铺：${目标店铺}`);

  console.log(`=== 只读核查：${店铺.name}（${店铺.id}）===`);
  const context = await 创建抖音账号浏览器上下文(店铺, { headless: false });
  try {
    const page = context.pages().find((p) => !p.isClosed()) || await context.newPage();
    const 业务页 = await 打开抖音待回传发票页面(page, 店铺);
    console.log('最终页面 URL:', 业务页.url());

    const orders = await 读取当前页待回传订单(业务页, 店铺);
    console.log('页面可见「待回传/待开票」订单数:', orders.length);
    for (const o of orders) {
      console.log('  -', o.orderNumber || o.orderNo || '(无单号)', '|', o.invoiceStatus || '', '|', o.invoiceApplyTime || '');
    }

    if (typeof 读取抖音可见提示文本列表 === 'function') {
      const texts = await 读取抖音可见提示文本列表(业务页).catch(() => []);
      console.log('页面可见提示文本（前 30 条）:');
      for (const t of texts.slice(0, 30)) console.log('   ·', String(t).replace(/\s+/g, ' ').slice(0, 120));
    }

    const 目标标签 = process.argv[3];
    if (目标标签) {
      const tab = 业务页.getByText(目标标签, { exact: true }).first();
      if (await tab.count()) {
        await tab.click({ timeout: 8000 }).catch((e) => console.log('点标签失败：', e.message));
        await 业务页.waitForTimeout(3000);
        console.log(`已切换到「${目标标签}」标签，URL:`, 业务页.url());
      } else {
        console.log(`页面上找不到「${目标标签}」标签`);
      }
    }

    const 行文本 = await 业务页.locator('table tbody tr').allInnerTexts().catch(() => []);
    console.log(`列表可见行数: ${行文本.length}`);
    for (const t of 行文本.slice(0, 10)) console.log('   ▸', String(t).replace(/\s+/g, ' ').slice(0, 200));

    const 截图 = path.join(base, 'runtime', 'screenshots', `today-check-${目标店铺}${目标标签 ? '-' + 目标标签 : ''}-${Date.now()}.png`);
    await 业务页.screenshot({ path: 截图 });
    console.log('截图已保存:', 截图);
  } finally {
    // 只读核查结束，关闭本进程打开的浏览器，避免占用资料目录。
    await context.close().catch(() => {});
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('只读核查失败：', (error && error.stack) || error);
  process.exit(1);
});
