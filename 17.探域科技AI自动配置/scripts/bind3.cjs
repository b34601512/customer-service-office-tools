const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^自动发送场景$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /添加策略/ }).click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/strat2.png' });
  const html = await page.evaluate(() => {
    const i = document.body.innerHTML.indexOf('绑定用户');
    return document.body.innerHTML.slice(Math.max(0, i - 500), i + 1500);
  });
  console.log('HTML', JSON.stringify(html).slice(0, 1500));
  console.log('DONE');
  await ctx.close();
})();
