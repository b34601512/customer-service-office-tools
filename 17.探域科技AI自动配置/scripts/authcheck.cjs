const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/groupAndStore/sub-account/accounts', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto-err', e.message));
  await page.waitForTimeout(4000);
  try {
    await page.getByText(/店铺管理/).first().click({ timeout: 10000 });
    await page.waitForTimeout(5000);
    console.log('SHOPURL', page.url());
    console.log('SHOPTEXT', JSON.stringify((await page.evaluate(() => document.body.innerText.slice(0, 3000))).slice(0, 3000)));
    await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/shop-manage.png' });
  } catch (e) { console.log('shop-err', e.message); }
  console.log('DONE');
  await ctx.close();
})();
