const { chromium } = require('playwright-core');
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('C:/Users/b3460/.pi-edge-work/hs-rows.json', 'utf8'));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('request', req => {
    if (/knowledge-card\/save/.test(req.url())) {
      fs.writeFileSync('C:/Users/b3460/.pi-edge-work/save-payload.txt', req.postData() || '', 'utf8');
      console.log('SAVE-CAPTURED len=' + (req.postData() || '').length);
    }
  });
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^知识库$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /新建知识/ }).click({ timeout: 8000 });
  await page.waitForTimeout(4000);
  await page.locator('input[placeholder*="请输入标题"]').fill(rows[0].t, { timeout: 10000 });
  console.log('TITLE-OK');
  // 内容编辑器:找contenteditable
  const ed = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[contenteditable="true"]')).map(e => e.className.slice(0, 80));
    return JSON.stringify(els.slice(0, 5));
  });
  console.log('EDITORS', ed.slice(0, 300));
  console.log('DONE');
  await ctx.close();
})();
