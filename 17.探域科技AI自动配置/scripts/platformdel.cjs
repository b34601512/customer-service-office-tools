const { chromium } = require('playwright-core');
const fs = require('fs');
const pats = ['京东', '天猫', '拼多多', '小蟹', '抖音', '国补', '延保', '运费险', '直播', '门店', '适老化', '云闪付', '甘快办', '天津', '甘肃', '365天', '365保险', '企业微信', '私域', '有赞', 'youzan', '小程序', '护士上门', '货到付款', '知你'];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async (pats) => {
    const pg = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 3000 }), credentials: 'include' })).json();
    const rs = (pg.data && pg.data.results) || [];
    const hit = rs.filter(c => { const s = (c.title || '') + ' ' + (c.content || []).map(x => x.content).join(' '); return pats.some(p => s.includes(p)); });
    let del = 'none';
    if (hit.length) {
      const ids = hit.map(h => h.id); const out = [];
      for (let i = 0; i < ids.length; i += 50) {
        const res = await fetch('/api/kbe/v1/knowledge-card/batch-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardIds: ids.slice(i, i + 50) }), credentials: 'include' });
        out.push(res.status + ':' + (await res.text()).slice(0, 50));
      }
      del = out.join('|');
    }
    return JSON.stringify({ total: pg.data.total, n: hit.length, hits: hit.map(h => h.title || '(无)'), del });
  }, pats);
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/platformdel-result.txt', r, 'utf8');
  console.log('n=' + JSON.parse(r).n + ' ' + JSON.parse(r).del);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
