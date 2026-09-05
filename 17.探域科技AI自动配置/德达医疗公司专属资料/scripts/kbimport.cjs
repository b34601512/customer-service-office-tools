const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^表格知识$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  try {
    await page.getByRole('button', { name: /新建表格/ }).click({ timeout: 8000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/new-table.png' });
    fs.writeFileSync('C:/Users/b3460/.pi-edge-work/new-table.txt', await page.evaluate(() => document.body.innerText.slice(-1500)), 'utf8');
    console.log('NEWTABLE-OPENED');
    await page.keyboard.press('Escape');
  } catch (e) { console.log('newtable-err'); }
  // 知识库导入入口
  await page.getByText(/^知识库$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(4000);
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/kb-page.txt', await page.evaluate(() => document.body.innerText.slice(-2000)), 'utf8');
  const r = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText.slice(0, 12)).filter(s => s).slice(0, 30));
  console.log('KB-BTNS', JSON.stringify(r).slice(0, 400));
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/kb-page.png' });
  console.log('DONE');
  await ctx.close();
})();
