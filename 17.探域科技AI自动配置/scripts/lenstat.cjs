const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async () => {
    const pg = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 3000 }), credentials: 'include' })).json();
    const rs = (pg.data && pg.data.results) || [];
    return JSON.stringify(rs.map(c => ({ t: c.title || '(无标题)', len: (c.content || []).map(x => (x.content || '').length).reduce((a, b) => a + b, 0) })));
  });
  const rows = JSON.parse(r).sort((a, b) => b.len - a.len);
  const buckets = { '>2000': 0, '1000-2000': 0, '500-1000': 0, '300-500': 0, '<300': 0 };
  for (const x of rows) { if (x.len > 2000) buckets['>2000']++; else if (x.len > 1000) buckets['1000-2000']++; else if (x.len > 500) buckets['500-1000']++; else if (x.len > 300) buckets['300-500']++; else buckets['<300']++; }
  const top = rows.slice(0, 60).map((x, i) => (i + 1) + '. [' + x.len + '字] ' + x.t);
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/long-list.txt', top.join('\n'), 'utf8');
  console.log(JSON.stringify(buckets) + ' total=' + rows.length);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
