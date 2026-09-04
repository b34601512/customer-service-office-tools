const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', {
    channel: 'msedge',
    headless: false,
    args: ['--start-maximized'],
    viewport: null
  });
  let page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded' }).catch(e => console.log('goto-err', e.message));
  console.log('EDGE-READY');
  for (let i = 0; i < 3600; i++) {
    try {
      const url = page.url();
      const cookies = await ctx.cookies().catch(() => []);
      const tanyu = cookies.filter(c => c.domain.includes('tanyuai')).map(c => ({ name: c.name, len: c.value.length }));
      fs.writeFileSync('C:/Users/b3460/.pi-edge-work/status.json', JSON.stringify({ url, tanyu, time: Date.now() }));
      if (i % 6 === 0) console.log('STATUS', url, JSON.stringify(tanyu));
    } catch (e) { console.log('loop-err', e.message); }
    await new Promise(r => setTimeout(r, 5000));
  }
})();
