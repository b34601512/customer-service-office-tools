const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/groupAndStore/product-management/list', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto-err', e.message));
  await page.waitForTimeout(6000);
  // 全选:点表头复选框
  try {
    const headerBox = page.locator('thead input[type="checkbox"], .ant-table-thead input[type="checkbox"]').first();
    if (await headerBox.count() > 0) { await headerBox.click({ timeout: 8000 }); console.log('SELECT-ALL-CLICKED'); }
    else {
      // 兜底:逐页勾选可见复选框
      const boxes = page.locator('tbody input[type="checkbox"]');
      const n = await boxes.count();
      for (let i = 0; i < n; i++) { try { await boxes.nth(i).check({ timeout: 3000 }); } catch {} }
      console.log('CHECKED-VISIBLE', n);
    }
  } catch (e) { console.log('select-err', e.message); }
  await page.waitForTimeout(2000);
  console.log('SELTEXT', JSON.stringify((await page.evaluate(() => document.body.innerText.slice(0, 500))).slice(0, 500)));
  try {
    await page.getByRole('button', { name: /添加AI商品学习/ }).click({ timeout: 10000 });
    console.log('ADD-CLICKED');
    await page.waitForTimeout(4000);
    // 确认弹窗
    const confirm = page.getByRole('button', { name: /^(确定|确认|提交)$/ });
    if (await confirm.count() > 0) { await confirm.first().click({ timeout: 8000 }); console.log('CONFIRMED'); }
    await page.waitForTimeout(6000);
    console.log('AFTER', JSON.stringify((await page.evaluate(() => document.body.innerText.slice(0, 800))).slice(0, 800)));
    await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/ai-learn.png' });
  } catch (e) { console.log('add-err', e.message); await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/ai-learn-err.png' }); }
  console.log('DONE');
  await ctx.close();
})();
