const { chromium } = require('playwright-core');
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('C:/Users/b3460/.pi-edge-work/hs-rows.json', 'utf8'));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async (row) => {
    const tries = [
      { title: row.t, content: [{ content: row.c.slice(0, 280) }], labels: [], ifBelievable: true, knowledgeType: 'CHAT', ifOpen: true },
      { title: row.t, content: [{ content: row.c.slice(0, 280) }], labels: [], ifBelievable: true, type: 'CHAT', ifOpen: true }
    ];
    const out = [];
    for (const b of tries) {
      try {
        const res = await fetch('/api/kbe/v1/knowledge-card/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), credentials: 'include' });
        out.push(JSON.stringify(b).slice(0, 80) + ' => ' + res.status + ' ' + (await res.text()).slice(0, 300));
      } catch (e) { out.push('ERR ' + e.message); }
      break;
    }
    return out.join('\n');
  }, rows[0]);
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/save-try.txt', r, 'utf8');
  console.log('TRY-DONE');
  console.log('DONE');
  await ctx.close();
})();
