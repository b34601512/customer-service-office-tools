const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');

const BACKUP = 'D:/备份文件夹/探域问答审核-20260907-gift-policy';
const body = c => (c.content || []).map(x => x.content || '').join('\n');

(async () => {
  fs.mkdirSync(BACKUP, { recursive: true });
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', {
    channel: 'msedge', headless: true
  });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await page.waitForTimeout(3000);
    const req = (url, data) => page.evaluate(async ({ url, data }) => {
      const r = await fetch(url, {
        method: data ? 'POST' : 'GET', credentials: 'include',
        headers: data ? { 'Content-Type': 'application/json' } : undefined,
        body: data ? JSON.stringify(data) : undefined
      });
      const j = await r.json();
      if (!r.ok || j.code !== 1) throw Error(`${url} ${r.status} ${j.code} ${j.msg || ''}`);
      return j.data;
    }, { url, data });
    const data = await req('/api/kbe/v1/knowledge-card/page', { pageNo: 1, pageSize: 3000 });
    const cards = data.results || [];
    const ids = new Set(cards.map(c => c.id));
    if (!cards.length || ids.size !== cards.length) throw Error('快照为空或ID重复，停止');
    fs.writeFileSync(path.join(BACKUP, 'before.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), total: data.total, cards }, null, 2));
    const re = /赠品|礼品|晒单|晒图|吸氧管|过滤器|过滤棉|雾化套装|吸氧面罩|血氧仪|氧气袋|鼻吸管|质保|保价|退货包运费|换款/;
    const hits = cards.filter(c => c.ifOpen && re.test(body(c))).map(c => ({
      id: c.id, title: c.title, type: c.type, includeCondition: c.includeCondition,
      orderStatus: c.orderStatus, content: body(c)
    }));
    fs.writeFileSync(path.join(BACKUP, 'candidates.json'), JSON.stringify(hits, null, 2));
    console.log(JSON.stringify({ total: data.total, returned: cards.length, unique: ids.size, candidates: hits.length, backup: BACKUP }, null, 2));
    for (const c of hits) console.log(`\n### ${c.id} ${c.title}\n${c.content}`);
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
