const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async () => {
    const cands = ['/kbe/v1/knowledge-card/batch-create', '/kbe/v1/knowledge-card/batch-save', '/kbe/v1/knowledge-card/import', '/kbe/v1/knowledge/batch-import'];
    const out = [];
    for (const u of cands) {
      try {
        const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}), credentials: 'include' });
        out.push(u + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 120));
      } catch (e) { out.push(u + ' ERR'); }
    }
    return out.join('\n');
  });
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/api-probe.txt', r, 'utf8');
  console.log('PROBE-DONE');
  // 新建知识弹窗看结构
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^知识库$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /新建知识/ }).click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/new-kb.png' });
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/new-kb.txt', await page.evaluate(() => document.body.innerText.slice(-1200)), 'utf8');
  console.log('DONE');
  await ctx.close();
})();
