const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^表格知识$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(4000);
  const t = await page.evaluate(() => document.body.innerText.slice(-2000));
  const r = await page.evaluate(() => {
    const fs = Array.from(document.querySelectorAll('input[type="file"]')).map(f => f.accept || 'any');
    const btns = Array.from(document.querySelectorAll('button')).map(b => b.innerText.slice(0, 10)).filter(s => s).slice(0, 30);
    return JSON.stringify({ files: fs, btns });
  });
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/table-kb.png' });
  const fs = require('fs');
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/table-kb.txt', t, 'utf8');
  console.log('TABLEKB-INFO', r.slice(0, 500));
  console.log('DONE');
  await ctx.close();
})();
