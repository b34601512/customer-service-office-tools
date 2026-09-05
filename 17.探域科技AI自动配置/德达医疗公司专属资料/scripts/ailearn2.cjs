const { chromium } = require('playwright-core');
async function addPage(page, pagenum) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(1000);
  if (pagenum === 2) {
    await page.evaluate(() => { document.querySelector('.ant-pagination-item-2')?.scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { document.querySelector('.ant-pagination-item-2')?.click(); });
    await page.waitForTimeout(4000);
  }
  const headerBox = page.locator('thead input[type="checkbox"], .ant-table-thead input[type="checkbox"]').first();
  await headerBox.click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /添加AI商品学习/ }).click({ timeout: 10000 });
  console.log('P' + pagenum, 'ADD-CLICKED');
  await page.waitForTimeout(3000);
  await page.locator('.ant-modal-confirm-btns .ant-btn-primary').first().click({ timeout: 10000 });
  console.log('P' + pagenum, 'CONFIRMED');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `C:/Users/b3460/.pi-edge-work/ai-learn-p${pagenum}.png` });
  console.log('P' + pagenum, 'TEXT', JSON.stringify((await page.evaluate(() => document.body.innerText.slice(0, 400))).slice(0, 400)));
}
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/groupAndStore/product-management/list', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto-err', e.message));
  await page.waitForTimeout(6000);
  try { await addPage(page, 1); } catch (e) { console.log('P1-err', e.message); }
  try { await addPage(page, 2); } catch (e) { console.log('P2-err', e.message); }
  console.log('DONE');
  await ctx.close();
})();
