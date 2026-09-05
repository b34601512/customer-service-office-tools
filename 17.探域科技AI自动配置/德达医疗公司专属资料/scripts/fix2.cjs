const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  // 1. 自动发送场景:默认改全自动
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  try {
    await page.getByText(/^自动发送场景$/).first().click({ timeout: 8000 });
    await page.waitForTimeout(3000);
    await page.getByText(/默认/, { exact: false }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2000);
    // 找全自动选项
    const full = page.getByText(/^全自动$/, { exact: false });
    if (await full.count() > 0) { await full.first().click({ timeout: 8000 }); console.log('FULLAUTO-SELECTED'); }
    await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/fix-autosend.png' });
    const save = page.getByRole('button', { name: /^保\s*存$/ });
    if (await save.count() > 0) { await save.first().click({ timeout: 8000 }); console.log('AUTOSEND-SAVED'); }
    await page.waitForTimeout(3000);
  } catch (e) { console.log('autosend-err', e.message.slice(0, 200)); }
  // 2. 防止抢话:改智能体优先
  try {
    await page.getByText(/^防止抢话$/).first().click({ timeout: 8000 });
    await page.waitForTimeout(3000);
    const radio = page.locator('input[type="radio"]').nth(1);
    if (await radio.count() > 0) { await radio.check({ timeout: 8000, force: true }); console.log('AGENT-FIRST-CHECKED'); }
    await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/fix-race.png' });
    const save = page.getByRole('button', { name: /^保\s*存$/ });
    if (await save.count() > 0) { await save.first().click({ timeout: 8000 }); console.log('RACE-SAVED'); }
    await page.waitForTimeout(3000);
  } catch (e) { console.log('race-err', e.message.slice(0, 200)); }
  console.log('DONE');
  await ctx.close();
})();
