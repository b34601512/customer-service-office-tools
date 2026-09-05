const { chromium } = require('playwright-core');
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('C:/Users/b3460/.pi-edge-work/hs-rows.json', 'utf8'));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  // 抓保存接口
  page.on('request', req => {
    const u = req.url();
    if (req.method() === 'POST' && /kbe|knowledge/i.test(u) && !/page|list|tag|label/i.test(u)) {
      console.log('API-CALL', u);
      console.log('PAYLOAD', (req.postData() || '').slice(0, 600));
    }
  });
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^知识库$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /新建知识/ }).click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  // 标题
  await page.locator('input[placeholder*="标题"], input[maxlength]').first().fill('【测试】' + rows[0].t, { timeout: 8000 });
  // 内容框
  await page.locator('textarea').first().fill(rows[0].c.slice(0, 290), { timeout: 8000 });
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/kb-fill.png' });
  console.log('FILLED-WAIT-REVIEW');
  console.log('DONE');
  await ctx.close();
})();
