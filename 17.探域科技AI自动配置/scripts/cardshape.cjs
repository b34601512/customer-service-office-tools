const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async () => {
    const p = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 2 }), credentials: 'include' })).json();
    const item = p.data && (p.data.list || p.data.records || p.data.items || [])[0];
    let detail = null;
    if (item) {
      const id = item.id || item.cardId || item.knowledgeId;
      try {
        detail = await (await fetch('/api/kbe/v1/knowledge-card/detail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }), credentials: 'include' })).text();
      } catch (e) { detail = 'ERR ' + e.message; }
    }
    return JSON.stringify({ keys: item ? Object.keys(item) : [], item: item ? JSON.stringify(item).slice(0, 800) : 'NO-ITEM raw=' + JSON.stringify(p).slice(0, 500), detail: detail ? String(detail).slice(0, 2000) : 'NO-DETAIL' });
  });
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/card-shape.txt', r, 'utf8');
  console.log('SHAPE-DONE');
  console.log('DONE');
  await ctx.close();
})();
