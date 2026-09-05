const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText('正式模式', { exact: true }).first().click({ timeout: 10000 }).catch(e => console.log('tab-err', e.message));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/sim-formal.png' });
  try {
    const box = page.getByPlaceholder(/模拟买家/);
    await box.click({ timeout: 10000 });
    await box.fill('为啥感觉氧气是辣的？');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(25000);
    const text = await page.evaluate(() => document.body.innerText);
    const i = text.lastIndexOf('为啥感觉氧气是辣的');
    console.log('FORMAL-AFTER', JSON.stringify(text.slice(i, i + 900)));
  } catch (e) { console.log('sim-err', e.message); }
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
