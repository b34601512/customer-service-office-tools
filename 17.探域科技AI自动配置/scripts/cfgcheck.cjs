const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto-err', e.message));
  await page.waitForTimeout(6000);
  for (const name of ['平台应用设置', '接待设置', 'AI协作']) {
    try {
      await page.getByText(new RegExp(name), { exact: false }).first().click({ timeout: 8000 });
      await page.waitForTimeout(3000);
      console.log('=='+name+'==', JSON.stringify((await page.evaluate(() => document.body.innerText.slice(2000, 5000))).slice(0, 1200)));
      await page.screenshot({ path: `C:/Users/b3460/.pi-edge-work/cfg-${name}.png` });
    } catch (e) { console.log(name + '-err', e.message); }
  }
  console.log('DONE');
  await ctx.close();
})();
