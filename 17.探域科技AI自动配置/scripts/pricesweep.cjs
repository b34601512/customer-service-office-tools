const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async () => {
    const pg = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 3000 }), credentials: 'include' })).json();
    const rs = (pg.data && pg.data.results) || [];
    const txt = c => (c.title || '') + ' ' + (c.content || []).map(x => x.content).join(' ');
    const pats = ['买贵补差', '全年底价', '晒图送', '前100名', '终身吸氧管', '下单即送', '满', '减', '券', '折'];
    const out = {};
    for (const p of pats) out[p] = rs.filter(c => txt(c).includes(p)).map(c => c.title || '(无标题)');
    return JSON.stringify({ total: pg.data.total, n: rs.length, out }, null, 1).slice(0, 4000);
  });
  console.log(r);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
