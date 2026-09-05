const { chromium } = require('playwright-core');
const fs = require('fs');
function bigrams(s) { const m = new Set(); for (let i = 0; i < s.length - 1; i++) m.add(s.slice(i, i + 2)); return m; }
function jacc(a, b) { let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter); }
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async () => {
    const pg = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 3000 }), credentials: 'include' })).json();
    const rs = (pg.data && pg.data.results) || [];
    return JSON.stringify({ total: pg.data.total, rows: rs.filter(c => !(c.title || '')).map(c => ({ id: c.id, txt: (c.content || []).map(x => x.content).join('\n') })).filter(c => c.txt.length > 500) });
  });
  const rows = JSON.parse(r).rows;
  const norm = rows.map(x => ({ id: x.id, len: x.txt.length, head: x.txt.replace(/\s+/g, '').slice(0, 60), bg: bigrams(x.txt.replace(/\s+/g, '')) }));
  const clusters = [];
  for (const n of norm) {
    let placed = false;
    for (const cl of clusters) { if (jacc(n.bg, cl[0].bg) >= 0.45) { cl.push(n); placed = true; break; } }
    if (!placed) clusters.push([n]);
  }
  const keep = new Set(), del = [];
  for (const cl of clusters) {
    cl.sort((a, b) => b.len - a.len);
    keep.add(cl[0].id);
    for (let i = 1; i < cl.length; i++) del.push(cl[i].id);
  }
  const report = clusters.map((cl, i) => '簇' + (i + 1) + '(n=' + cl.length + '): 留[' + cl[0].len + '字]' + cl[0].head + (cl.length > 1 ? ' 删' + (cl.length - 1) + '条' : '')).join('\n');
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/dedup-report.txt', '长无标题>500字共' + rows.length + '条, 聚' + clusters.length + '簇\n' + report, 'utf8');
  let delResp = 'none';
  if (del.length) {
    delResp = await page.evaluate(async (ids) => {
      const res = await fetch('/api/kbe/v1/knowledge-card/batch-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardIds: ids }), credentials: 'include' });
      return res.status + ' ' + (await res.text()).slice(0, 120);
    }, del);
  }
  const total = await page.evaluate(async () => {
    const pg = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 10 }), credentials: 'include' })).json();
    return pg.data.total;
  });
  console.log('GROUPS=' + rows.length + ' CLUSTERS=' + clusters.length + ' DEL=' + del.length + ' ' + delResp + ' total=' + total);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
