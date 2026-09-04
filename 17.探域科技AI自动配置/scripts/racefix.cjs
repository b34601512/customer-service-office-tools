const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^防止抢话$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  // 点“智能体优先”整行
  await page.locator('label:has-text("智能体优先")').first().click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  const st1 = await page.evaluate(() => {
    const rs = Array.from(document.querySelectorAll('input[type="radio"]')).map(r => r.checked);
    return JSON.stringify(rs);
  });
  console.log('AFTER-CLICK-RADIOS', st1);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/race-before-save.png' });
  await page.getByRole('button', { name: /^保\s*存$/ }).first().click({ timeout: 8000 });
  console.log('SAVE-CLICKED');
  await page.waitForTimeout(4000);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^防止抢话$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  const st2 = await page.evaluate(() => {
    const rs = Array.from(document.querySelectorAll('input[type="radio"]')).map(r => r.checked);
    return JSON.stringify(rs);
  });
  console.log('AFTER-RELOAD-RADIOS', st2);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/race-after-reload.png' });
  console.log('DONE');
  await ctx.close();
})();
