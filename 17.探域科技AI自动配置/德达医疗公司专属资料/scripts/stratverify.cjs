const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^自动发送场景$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(4000);
  const t = await page.evaluate(() => document.body.innerText.slice(-800));
  console.log('PERSIST', JSON.stringify(t).slice(0, 600));
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/strategy-persist.png' });
  console.log('DONE');
  await ctx.close();
})();
