const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto-err', e.message));
  await page.waitForTimeout(4000);
  console.log('TITLE', await page.title());
  console.log('URL', page.url());
  const summary = await page.evaluate(async () => {
    const r = await fetch('/api/data-service/business/compass/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statType: 'natural_day', platform: 0, dimension: 'platform' }), credentials: 'include' });
    return (await r.text()).slice(0, 1000);
  }).catch(e => 'eval-err ' + e.message);
  console.log('SUMMARY', summary);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/dashboard.png' }).catch(e => console.log('shot-err', e.message));
  console.log('DONE');
  await ctx.close();
})();
