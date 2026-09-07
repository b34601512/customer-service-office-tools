const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const body = c => (c.content || []).map(x => x.content || '').join('\n');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const data = await page.evaluate(async () => {
      const r = await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 3000 }) });
      const j = await r.json(); if (!r.ok || j.code !== 1) throw Error('page failed'); return j.data;
    });
    const rows = (data.results || []).filter(c => c.ifOpen && ((c.includeCondition?.shop || []).some(x => x.thirdShopId === '2095398963959042048') || (c.includeCondition?.spu || []).some(x => x.thirdShopId === '2095398963959042048')));
    const old = rows.filter(c => /仅C1型号不参加|仅C1型号不参加额外赠品|C1仍不参加额外赠品|具体规格不预先承诺|按详情页|按包装/.test(body(c)));
    const gift = rows.filter(c => /赠品|礼品|晒单|晒图|吸氧面罩|终身吸氧管/.test(body(c)));
    console.log(JSON.stringify({ total: data.total, returned: (data.results || []).length, scoped: rows.length, giftScoped: gift.length, oldRuleResiduals: old.map(c => ({ id: c.id, type: c.type, title: c.title })) }, null, 2));
    if (old.length) process.exitCode = 1;
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
