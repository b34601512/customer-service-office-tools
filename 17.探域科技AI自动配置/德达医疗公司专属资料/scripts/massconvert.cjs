const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const list = await page.evaluate(async () => {
    const pg = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 3000 }), credentials: 'include' })).json();
    const rs = (pg.data && pg.data.results) || [];
    return JSON.stringify(rs.filter(c => (c.title || '') && !/^(测试\/转全店)/.test(c.title || '')).map(c => ({ id: c.id, t: c.title, a: (c.content || []).map(x => x.content).join('\n') })));
  });
  const items = JSON.parse(list);
  console.log('TOTAL-TODO ' + items.length);
  let ok = 0, fail = 0;
  const CH = 20;
  for (let i = 0; i < items.length; i += CH) {
    const chunk = items.slice(i, i + CH).map(c => {
      const q = c.t.split('/').pop();
      const hasQ = /^Q[:：]/.test(c.a.trim());
      return { id: c.id, title: c.t, content: hasQ ? c.a : ('Q:' + q + '\nA:' + c.a) };
    });
    const r = await page.evaluate(async (items) => {
      let ok = 0, fail = 0;
      for (const it of items) {
        try {
          const res = await fetch('/api/kbe/v1/knowledge-card/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ id: it.id, title: it.title, content: [{ content: it.content }], labels: [], ifBelievable: true, knowledgeType: 'SHOP', ifOpen: true }) });
          const t = await res.text();
          if (res.status === 200 && t.includes('成功')) ok++; else fail++;
        } catch (e) { fail++; }
        await new Promise(r => setTimeout(r, 200));
      }
      return JSON.stringify({ ok, fail });
    }, chunk);
    const o = JSON.parse(r); ok += o.ok; fail += o.fail;
    console.log('PROGRESS ' + Math.min(i + CH, items.length) + '/' + items.length + ' ok=' + ok + ' fail=' + fail);
  }
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/massconvert-result.txt', 'ok=' + ok + ' fail=' + fail, 'utf8');
  console.log('DONE ok=' + ok + ' fail=' + fail);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
