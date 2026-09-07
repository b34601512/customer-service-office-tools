const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const B = 'D:/备份文件夹/探域问答审核-20260907-gift-policy';
const plan = JSON.parse(fs.readFileSync(path.join(B, 'plan.json'), 'utf8'));
const body = c => (c.content || []).map(x => x.content || '').join('\n');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const detail = id => page.evaluate(async id => {
      const r = await fetch('/api/kbe/v1/knowledge-card/detail?id=' + encodeURIComponent(id), { credentials: 'include' });
      const j = await r.json(); if (!r.ok || j.code !== 1) throw Error('detail failed ' + id); return j.data;
    }, id);
    const rows = [];
    for (const x of plan) {
      const c = await detail(x.id); const s = body(c);
      rows.push({ id: x.id, same: s === x.after, shopBound: (c.includeCondition?.shop || []).some(v => v.thirdShopId === '2095398963959042048'), oldExclusion: /仅C1型号不参加|C1仍不参加额外赠品|C1L及其他非C1型号/.test(s), vagueQty: /具体规格不预先承诺|按详情页|按包装/.test(s), exact: ['吸氧管1根','过滤器＋过滤棉1份','终身吸氧管4根','邮费13元','压缩机5年质保','平台承担退货运费'].every(v => s.includes(v)) });
    }
    const result = { checked: rows.length, same: rows.filter(x => x.same).length, shopBound: rows.filter(x => x.shopBound).length, oldExclusion: rows.filter(x => x.oldExclusion).length, vagueQty: rows.filter(x => x.vagueQty).length, exact: rows.filter(x => x.exact).length, failures: rows.filter(x => !x.same || x.oldExclusion || x.vagueQty || !x.exact) };
    fs.writeFileSync(path.join(B, 'verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), result, rows }, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (result.failures.length) process.exitCode = 1;
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
