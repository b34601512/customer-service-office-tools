const { chromium } = require('playwright-core');
const delIds = ['6a9a48d4644e354d71a4003c','6a9a3c4b4a45121da4d7c896','6a9a3c464a45121da4d7c7ab','6a9a3c454a45121da4d7c776','6a9a3c454a45121da4d7c770','6a9a3c454a45121da4d7c76f','6a9a3c454a45121da4d7c76d','6a9a3c454a45121da4d7c76c','6a9a3c40644e354d71a3f894','6a9a3c49644e354d71a3fa0a'];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async (args) => {
    const out = {};
    const d = await fetch('/api/kbe/v1/knowledge-card/batch-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardIds: args.del }), credentials: 'include' });
    out.del = d.status + ' ' + (await d.text()).slice(0, 80);
    const pg = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 3000 }), credentials: 'include' })).json();
    const rs = (pg.data && pg.data.results) || [];
    const target = rs.find(c => c.id === '6a9a3c484a45121da4d7c81f');
    if (target) {
      const newContent = (target.content || []).map(x => ({ content: (x.content || '').replace('1L：90%', '1L：96%') }));
      const u = await fetch('/api/kbe/v1/knowledge-card/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: target.id, title: target.title, content: newContent, labels: [], ifBelievable: true, knowledgeType: 'CHAT', ifOpen: true }), credentials: 'include' });
      out.upd = u.status + ' ' + (await u.text()).slice(0, 120);
    } else out.upd = 'target-missing';
    const pg2 = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 3000 }), credentials: 'include' })).json();
    const rs2 = (pg2.data && pg2.data.results) || [];
    out.total = pg2.data.total;
    out.dup18 = rs2.filter(c => (c.title || '').includes('1-8升')).map(c => c.id);
    return JSON.stringify(out);
  }, { del: delIds });
  console.log(r);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
