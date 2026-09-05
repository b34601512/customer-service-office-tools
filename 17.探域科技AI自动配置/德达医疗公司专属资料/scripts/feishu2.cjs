const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://my.feishu.cn/wiki/IANhwhmQCio7cxkBdBacnVK5nBh', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto-err', e.message));
  await page.waitForTimeout(6000);
  const pwd = await page.locator('input[type="password"], input[type="text"]').first().count();
  console.log('INPUTS', pwd);
  try {
    await page.locator('input[type="password"], input[type="text"]').first().fill('3189&63s', { timeout: 10000 });
    console.log('FILLED');
  } catch (e) { console.log('fill-err', e.message); }
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/feishu-pwd.png' }).catch(() => {});
  try {
    await page.getByRole('button', { name: /确定/ }).click({ timeout: 10000 });
    console.log('CLICKED');
  } catch (e) { console.log('click-err', e.message); }
  await page.waitForTimeout(8000);
  console.log('TITLE', await page.title());
  console.log('URL', page.url());
  const text = await page.evaluate(() => document.body.innerText.slice(0, 4000)).catch(e => 'eval-err ' + e.message);
  console.log('TEXT', JSON.stringify(text));
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/feishu-open.png' }).catch(() => {});
  console.log('DONE');
  await ctx.close();
})();
