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
  page.on('response', async res => {
    if (/knowledge-card\/save/.test(res.url())) {
      console.log('SAVE-RESP', res.status(), (await res.text()).slice(0, 200));
    }
  });
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^知识库$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /新建知识/ }).click({ timeout: 8000 });
  await page.waitForTimeout(4000);
  await page.locator('input[placeholder*="请输入标题"]').fill(rows[0].t, { timeout: 10000 });
  await page.locator('.ProseMirror').first().click({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.keyboard.type(rows[0].c.slice(0, 280), { delay: 2 });
  await page.waitForTimeout(1500);
  console.log('CONTENT-OK');
  // 勾可信(若未勾)
  try {
    const cb = page.locator('input[type="checkbox"]').first();
    if (!(await cb.isChecked())) { await cb.check({ force: true }); console.log('BELIEVE-CHECKED'); }
    else console.log('BELIEVE-ALREADY');
  } catch (e) { console.log('cb-err'); }
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/kb-ready.png' });
  await page.getByRole('button', { name: /保存并启用/ }).click({ timeout: 10000 });
  console.log('SAVE-CLICKED');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/kb-saved.png' });
  console.log('DONE');
  await ctx.close();
})();
