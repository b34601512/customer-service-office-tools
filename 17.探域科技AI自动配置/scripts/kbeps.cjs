const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(8000);
  const eps = await page.evaluate(async () => {
    const src = document.querySelector('script[src*="assets/index-"]').src;
    const txt = await (await fetch(src)).text();
    const set = new Set();
    const re = /kbe\/v1\/[a-zA-Z0-9_.\-\/]+/g;
    let m;
    while ((m = re.exec(txt))) set.add(m[0]);
    return { len: txt.length, eps: Array.from(set).slice(0, 80) };
  });
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/kbe-endpoints.txt', JSON.stringify(eps, null, 1), 'utf8');
  console.log('LEN', eps.len, 'COUNT', eps.eps.length);
  console.log('DONE');
  await ctx.close();
})();
