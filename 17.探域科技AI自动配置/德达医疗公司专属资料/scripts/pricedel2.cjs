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
    const tPats = ['付款/京东1店/1000-80', '付款/天猫1店二次催付话术/300-30', '付款/京东3店/500-50', 'Q1W优惠券链接', '价格/京东国补活动/怎么享受国补价格', '等双11活动【满足即时需求】', '我想等双11再买', '退货/同意折旧退'];
    const tExc = ['价格/国补通用话术/国补订单可以改地址吗？'];
    const uPats = ['晒图送', '下单即送', '终身吸氧管'];
    const hit = rs.filter(c => {
      const t = c.title || '';
      if (t && tPats.some(p => t.includes(p)) && !tExc.some(e => t === e)) return true;
      if (!t) { const s = (c.content || []).map(x => x.content).join(' '); if (uPats.some(p => s.includes(p))) return true; }
      return false;
    });
    let del = 'none';
    if (hit.length) {
      const ids = hit.map(h => h.id);
      const out = [];
      for (let i = 0; i < ids.length; i += 50) {
        const res = await fetch('/api/kbe/v1/knowledge-card/batch-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardIds: ids.slice(i, i + 50) }), credentials: 'include' });
        out.push(res.status + ':' + (await res.text()).slice(0, 50));
      }
      del = out.join('|');
    }
    return JSON.stringify({ total: pg.data.total, n: hit.length, hits: hit.map(h => (h.title || '(无)')), del });
  });
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/pricedel2-result.txt', r, 'utf8');
  console.log(r.slice(0, 2000));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
