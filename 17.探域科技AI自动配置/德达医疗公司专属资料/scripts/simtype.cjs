const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const box = page.getByPlaceholder(/模拟买家/);
  for (const q of ['香蕉测试全店怎么说', '香蕉测试聊天怎么说']) {
    await box.click({ timeout: 10000 });
    await box.fill(q);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(20000);
    const text = await page.evaluate(() => document.body.innerText);
    const i = text.lastIndexOf(q);
    console.log('Q=' + q, '=>', JSON.stringify(text.slice(i, i + 400)));
  }
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
