const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  const out = [];
  for (const p of [1, 2]) {
    await page.goto('http://agent.tanyuai.com/v2/groupAndStore/product-management/list', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);
    if (p === 2) { await page.evaluate(() => { document.querySelector('.ant-pagination-item-2')?.click(); }); await page.waitForTimeout(4000); }
    const rows = await page.evaluate(() => {
      const t = document.body.innerText;
      const m1 = (t.match(/AI商品学习中/g) || []).length;
      const m2 = (t.match(/普通商品/g) || []).length;
      return { learning: m1, normal: m2 };
    });
    out.push('P' + p + ' ' + JSON.stringify(rows));
  }
  console.log(out.join(' | '));
  console.log('DONE');
  await ctx.close();
})();
