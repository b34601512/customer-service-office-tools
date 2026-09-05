const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(8000);
  const s = await page.evaluate(async () => {
    const src = document.querySelector('script[src*="assets/index-"]').src;
    const txt = await (await fetch(src)).text();
    const i = txt.indexOf('knowledge-card/save');
    // 找附近的函数名/参数
    const near = txt.slice(Math.max(0, i - 3000), i + 500);
    // 找contentSegments之类字段
    const keys = ['title', 'contentList', 'segments', 'labelIds', 'ifBelievable', 'knowledgeType', 'shopIds', 'ifOpen', 'matchType'];
    const found = keys.filter(k => near.includes(k));
    return JSON.stringify({ near: near.slice(-2500), found });
  });
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/save-shape.txt', s, 'utf8');
  console.log('SAVE-SHAPE-DONE');
  console.log('DONE');
  await ctx.close();
})();
