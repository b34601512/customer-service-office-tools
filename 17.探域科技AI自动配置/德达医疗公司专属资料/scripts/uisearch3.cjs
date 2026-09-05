const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(8000);
  // 抓页面发出的搜索请求
  let lastReq = '';
  page.on('request', req => { const u = req.url(); if (/knowledge|search/i.test(u) && req.method() === 'POST') lastReq = u + ' ' + (req.postData() || '').slice(0, 200); });
  const box = page.getByPlaceholder('请输入知识内容进行搜索');
  for (const kw of ['噪音', '感觉辣刺鼻']) {
    await box.fill(kw);
    await page.waitForTimeout(300);
    await box.press('Enter');
    await page.waitForTimeout(4000);
    const txt = await page.evaluate(() => document.body.innerText);
    const m = txt.match(/没有找到匹配的结果|条结果|共\d+条/) || ['?'];
    console.log(kw, '=>', m[0], '| REQ:', lastReq.slice(0, 220));
    lastReq = '';
  }
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
