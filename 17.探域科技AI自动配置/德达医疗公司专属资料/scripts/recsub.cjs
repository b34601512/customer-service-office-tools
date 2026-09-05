const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  for (const name of ['会话周期', '手动转交话术', '买家称呼', '亮灯读秒', '防止抢话', '自动发送场景', '回复标识']) {
    try {
      await page.getByText(new RegExp('^' + name + '$')).first().click({ timeout: 6000 });
      await page.waitForTimeout(2500);
      const t = await page.evaluate(() => document.body.innerText);
      console.log('=='+name+'== ' + JSON.stringify(t.slice(-600)));
    } catch (e) { console.log('==' + name + '== FAIL'); }
  }
  console.log('DONE');
  await ctx.close();
})();
