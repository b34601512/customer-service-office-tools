const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async () => {
    const p = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 1 }), credentials: 'include' })).json();
    const item = (p.data.results || [])[0];
    const id = item && item.id;
    let d1 = '', d2 = '';
    try { d1 = await (await fetch('/api/kbe/v1/knowledge-card/detail?id=' + id, { credentials: 'include' })).text(); } catch (e) { d1 = 'ERR'; }
    try { d2 = await (await fetch('/api/kbe/v1/knowledge-card/detail?cardId=' + id, { credentials: 'include' })).text(); } catch (e) { d2 = 'ERR'; }
    return JSON.stringify({ id, type: item && item.type, d1: d1.slice(0, 3000), d2: d2.slice(0, 500) });
  });
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/card-detail.txt', r, 'utf8');
  console.log('DETAIL-DONE');
  console.log('DONE');
  await ctx.close();
})();
