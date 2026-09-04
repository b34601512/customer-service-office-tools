const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^自动发送场景$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  // 打开绑定用户下拉看选项(只看不动)
  try {
    await page.getByText(/请选择/).first().click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    const opts = await page.evaluate(() => document.body.innerText.slice(-2000));
    console.log('OPTS', JSON.stringify(opts).slice(0, 1200));
    await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/bind-opts.png' });
    await page.keyboard.press('Escape');
  } catch (e) { console.log('drop-err', e.message.slice(0, 150)); }
  console.log('DONE');
  await ctx.close();
})();
