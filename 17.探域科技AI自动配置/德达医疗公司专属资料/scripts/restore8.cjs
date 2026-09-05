const { chromium } = require('playwright-core');
const fs = require('fs');
const hs = JSON.parse(fs.readFileSync('C:/Users/b3460/.pi-edge-work/hs-all.json', 'utf8'));
const wants = ['湖南有实体店吗', '发货被退回，邮政带电池物品', '机器上没有二维码怎么办', '买的时候没说是压缩机5年质保', '给我保修卡，保修合同，质保合同', '机器是一年以前生产', '可以24小时使用吗', 'Y5AW制氧机卖点'];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const found = wants.map(w => hs.find(h => ((h.title || '') + (h.q || '')).includes(w))).filter(Boolean);
  console.log('MATCH ' + found.length);
  const r = await page.evaluate(async (items) => {
    let ok = 0; const fail = [];
    for (const it of items) {
      try {
        const res = await fetch('/api/kbe/v1/knowledge-card/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ title: it.title || it.q, content: [{ content: it.content || it.a }], labels: [], ifBelievable: true, knowledgeType: 'CHAT', ifOpen: true }) });
        if ((await res.text()).includes('成功')) ok++; else fail.push(it.title);
      } catch (e) { fail.push(it.title); }
      await new Promise(r => setTimeout(r, 300));
    }
    const pg = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 3000 }), credentials: 'include' })).json();
    const rs = (pg.data && pg.data.results) || [];
    const spec = ['Q5L', 'Y5W', 'Y300W', '365天稳定运行'].map(k => ({ k, n: rs.filter(c => ((c.title || '') + ' ' + (c.content || []).map(x => x.content).join(' ')).includes(k)).length }));
    return JSON.stringify({ ok, fail, total: pg.data.total, n: rs.length, spec });
  }, found);
  console.log(r);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
