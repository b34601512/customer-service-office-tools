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
    // 找save调用:形如 X({title:...,content...}) 搜"knowledgeType"附近的save组装
    const idx = [];
    let p = txt.indexOf('knowledge-card/save');
    // 向后找调用者:取该位置前后函数;改为搜所有"contentSegments"或"segments"定义
    const keys = ['contentSegments', 'segments', 'cardContent', 'knowledgeContent', 'contentList'];
    const hits = keys.map(k => ({ k, i: txt.indexOf(k) })).filter(h => h.i > 0);
    // 取save函数名前变量名:v1t的定义位置
    const def = txt.indexOf('knowledge-card/save');
    // 找调用点:v1t(
    const calls = [];
    let q = 0;
    while ((q = txt.indexOf('v1t(', q + 1)) > 0 && calls.length < 5) { calls.push(q); }
    let ctxs = calls.map(c => txt.slice(Math.max(0, c - 1200), c + 100));
    return JSON.stringify({ saveIdx: def, hits, ctxs: ctxs.map(c => c.slice(-1200)) });
  });
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/save-calls.txt', s, 'utf8');
  console.log('CALLS-DONE');
  console.log('DONE');
  await ctx.close();
})();
