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
    return JSON.stringify(rs.map(c => ({ id: c.id, t: c.title || '', len: (c.content || []).map(x => (x.content || '').length).reduce((a, b) => a + b, 0), head: ((c.content || []).map(x => x.content).join(' ') || '').replace(/[\r\n]+/g, ' ').slice(0, 100) })).sort((a, b) => b.len - a.len).slice(0, 50));
  });
  const rows = JSON.parse(r);
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/long-head.txt', rows.map((x, i) => (i + 1) + '. [' + x.len + '字] ' + (x.t || '(无标题)') + ' | ' + x.head).join('\n'), 'utf8');
  console.log('OK ' + rows.length);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
