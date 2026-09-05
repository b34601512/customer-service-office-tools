const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  for (const [name, file] of [['自动发送场景', 'auto-send'], ['防止抢话', '抢话'], ['欢迎语', 'welcome']]) {
    try {
      await page.getByText(new RegExp('^' + name + '$')).first().click({ timeout: 6000 });
      await page.waitForTimeout(2500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `C:/Users/b3460/.pi-edge-work/${file}.png`, fullPage: false });
      console.log(name, 'SHOT-OK');
    } catch (e) { console.log(name, 'FAIL'); }
  }
  console.log('DONE');
  await ctx.close();
})();
