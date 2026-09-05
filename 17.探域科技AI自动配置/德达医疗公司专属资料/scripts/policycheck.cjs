const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  for (const name of ['欢迎语', '商品卖点', '触发器', '兜底话术', '话术拦截', '自定义Agent', '记忆', '场景库']) {
    try {
      await page.getByText(new RegExp('^' + name + '$')).first().click({ timeout: 6000 });
      await page.waitForTimeout(2500);
      const t = await page.evaluate(() => document.body.innerText.slice(0, 4000));
      const mid = t.slice(t.length - 1500);
      const empty = /暂无数据|添加.*后才|还没有|为空/.test(mid) ? 'EMPTY?' : 'HAS-CONTENT?';
      console.log('=='+name+'== ' + empty + ' :: ' + JSON.stringify(mid.slice(0, 300)));
    } catch (e) { console.log('==' + name + '== CLICK-FAIL'); }
  }
  console.log('DONE');
  await ctx.close();
})();
