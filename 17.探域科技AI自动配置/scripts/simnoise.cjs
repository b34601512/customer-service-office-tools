const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto-err', e.message));
  await page.waitForTimeout(6000);
  try {
    const box = page.getByPlaceholder(/模拟买家/);
    await box.click({ timeout: 10000 });
    await box.fill('你好，请问噪音大吗？');
    console.log('FILLED');
    await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/sim-before.png' });
    await page.keyboard.press('Enter');
    console.log('SENT');
    await page.waitForTimeout(25000);
    const text = await page.evaluate(() => document.body.innerText.slice(0, 3000)).catch(e => 'err ' + e.message);
    console.log('AFTER', JSON.stringify(text).slice(0, 2500));
    await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/sim-after.png' });
  } catch (e) { console.log('sim-err', e.message); }
  console.log('DONE');
  await ctx.close();
})();
