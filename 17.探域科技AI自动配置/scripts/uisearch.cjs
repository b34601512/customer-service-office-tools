const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto-err', e.message));
  await page.waitForTimeout(8000);
  console.log('TITLE', await page.title());
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/kb-ui.png' });
  const inputs = await page.locator('input').all();
  console.log('INPUTS', inputs.length);
  // 找到搜索框: placeholder 含 搜/问题/标题
  let box = null;
  for (const inp of inputs) {
    const ph = (await inp.getAttribute('placeholder').catch(() => '')) || '';
    if (/搜|问题|标题|内容/.test(ph)) { console.log('BOX-PH', ph); box = inp; break; }
  }
  if (box) {
    await box.fill('辣');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/kb-ui-filled.png' });
    const btn = page.getByRole('button', { name: /^搜索$/ }).first();
    await btn.click({ timeout: 8000 }).catch(e => console.log('btn-err', e.message));
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/kb-ui-result.png' });
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 1500));
    console.log('RESULT-TEXT', JSON.stringify(txt.slice(-800)));
  }
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
