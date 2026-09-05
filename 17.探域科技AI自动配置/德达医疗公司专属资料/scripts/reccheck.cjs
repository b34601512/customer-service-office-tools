const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  for (const name of ['接待设置', 'AI协作']) {
    try {
      await page.getByText(new RegExp('^' + name + '$')).first().click({ timeout: 6000 });
      await page.waitForTimeout(2500);
      const t = await page.evaluate(() => {
        const el = document.querySelector('.ant-switch, [role="switch"]');
        const all = Array.from(document.querySelectorAll('.ant-switch')).map(s => s.getAttribute('aria-checked'));
        return document.body.innerText.slice(-2500) + ' ||SWITCHES|| ' + JSON.stringify(all.slice(0, 20));
      });
      console.log('=='+name+'== ' + JSON.stringify(t).slice(0, 800));
      await page.screenshot({ path: `C:/Users/b3460/.pi-edge-work/recv-${name}.png` });
    } catch (e) { console.log('==' + name + '== FAIL ' + e.message.slice(0, 100)); }
  }
  console.log('DONE');
  await ctx.close();
})();
