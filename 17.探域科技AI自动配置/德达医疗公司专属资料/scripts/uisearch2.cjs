const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto-err', e.message));
  await page.waitForTimeout(8000);
  await page.getByText('知识视图', { exact: true }).first().click({ timeout: 8000 }).catch(e => console.log('tab-err', e.message));
  await page.waitForTimeout(3000);
  const box = page.getByPlaceholder('请输入知识内容进行搜索');
  await box.fill('氧气辣');
  await page.waitForTimeout(500);
  await box.press('Enter');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/kb-ui-r2.png' });
  const txt = await page.evaluate(() => document.body.innerText);
  const i = txt.indexOf('搜知识');
  console.log('AFTER-SEARCH', JSON.stringify(txt.slice(i, i + 600)));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
