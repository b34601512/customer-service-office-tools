const { chromium } = require('playwright-core');
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('C:/Users/b3460/.pi-edge-work/hs-all.json', 'utf8'));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  let ok = 0, fail = 0;
  const CONC = 4;
  for (let i = 0; i < rows.length; i += CONC) {
    const batch = rows.slice(i, i + CONC).map((row, k) => ({ row, idx: i + k }));
    const res = await page.evaluate(async (items) => {
      const rs = await Promise.all(items.map(async ({ row, idx }) => {
        try {
          const res = await fetch('/api/kbe/v1/knowledge-card/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: row.title, content: [{ content: row.content }], labels: [], ifBelievable: true, knowledgeType: 'CHAT', ifOpen: true }), credentials: 'include' });
          const t = await res.text();
          return { idx, ok: res.status === 200 && t.includes('"success":true'), info: t.slice(0, 80) };
        } catch (e) { return { idx, ok: false, info: e.message.slice(0, 80) }; }
      }));
      return rs;
    }, batch);
    for (const r of res) { if (r.ok) ok++; else { fail++; fs.appendFileSync('C:/Users/b3460/.pi-edge-work/hs-fail.txt', r.idx + ' ' + r.info + '\n'); } }
    if ((i + CONC) % 100 < CONC) console.log(JSON.stringify({ progress: { current: Math.min(i + CONC, rows.length), total: rows.length, message: `ok=${ok} fail=${fail}` } }));
  }
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/hs-result.txt', `ok=${ok} fail=${fail} total=${rows.length}`, 'utf8');
  console.log(`BATCH-DONE ok=${ok} fail=${fail}`);
  await ctx.close();
})();
