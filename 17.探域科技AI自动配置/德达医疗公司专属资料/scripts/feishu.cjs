const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://my.feishu.cn/wiki/IANhwhmQCio7cxkBdBacnVK5nBh', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto-err', e.message));
  await page.waitForTimeout(8000);
  console.log('TITLE', await page.title());
  console.log('URL', page.url());
  const text = await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(e => 'eval-err ' + e.message);
  console.log('TEXT', JSON.stringify(text));
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/feishu.png' }).catch(e => console.log('shot-err', e.message));
  console.log('DONE');
  await ctx.close();
})();
