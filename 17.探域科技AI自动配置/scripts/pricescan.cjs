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
    const re = /[0-9]+(\.[0-9]+)?\s*(元|块钱|块|毛|折|券)|满\s*[0-9]+\s*减|保价|补差|折旧|押金|补偿|补贴|优惠券|立减|直降|券后|到手价|度电|电费|item\.jd|detail\.tmall|youzan|运费险|包邮|免邮|邮费/g;
    const hit = rs.filter(c => { const s = (c.title || '') + ' ' + (c.content || []).map(x => x.content).join(' '); return re.test(s); });
    return JSON.stringify({ total: pg.data.total, n: hit.length, rows: hit.map(c => c.id + '\t' + (c.title || '(无标题)') + '\t' + (c.content || []).map(x => x.content).join(' ').replace(/[\r\n]+/g, ' ').slice(0, 80)) });
  });
  const o = JSON.parse(r);
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/price-list.txt', o.rows.join('\n'), 'utf8');
  console.log('total=' + o.total + ' priceHits=' + o.n);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
