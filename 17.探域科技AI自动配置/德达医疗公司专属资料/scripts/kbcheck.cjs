const { chromium } = require('playwright-core');
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('C:/Users/b3460/.pi-edge-work/hs-rows.json', 'utf8'));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async (kw) => {
    const p = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 5, keyword: kw }), credentials: 'include' })).json();
    return JSON.stringify({ total: p.data && p.data.total, first: JSON.stringify((p.data.results || [])[0]).slice(0, 400) });
  }, rows[0].t.slice(0, 8));
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/kb-check.txt', r, 'utf8');
  console.log('CHECK-DONE');
  console.log('DONE');
  await ctx.close();
})();
