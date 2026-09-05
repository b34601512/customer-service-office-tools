const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  for (const [name, url] of [['builder', 'http://agent.tanyuai.com/v2/agent-builder'], ['dashboard', 'http://agent.tanyuai.com/v2/dashboard']]) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log(name, 'goto-err', e.message));
    await page.waitForTimeout(5000);
    console.log(name.toUpperCase(), await page.title(), page.url());
    console.log(name.toUpperCase(), 'TEXT', JSON.stringify((await page.evaluate(() => document.body.innerText.slice(0, 1500)).catch(e => 'err ' + e.message))));
    await page.screenshot({ path: `C:/Users/b3460/.pi-edge-work/${name}.png` }).catch(e => console.log(name, 'shot-err', e.message));
  }
  // 点侧边栏集团与店铺
  try {
    await page.getByText(/集团与店铺/).click({ timeout: 10000 });
    await page.waitForTimeout(5000);
    console.log('GROUPPAGE', page.url());
    console.log('GROUPPAGE', 'TEXT', JSON.stringify((await page.evaluate(() => document.body.innerText.slice(0, 1500))).slice(0, 1500)));
    await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/group-shop.png' });
  } catch (e) { console.log('group-click-err', e.message); }
  console.log('DONE');
  await ctx.close();
})();
