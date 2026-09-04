const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(8000);
  let lastResp = '';
  page.on('response', async res => {
    if (/knowledge-card\/page/.test(res.url()) && res.request().method() === 'POST') {
      try { const j = await res.json(); lastResp = 'total=' + (j.data && j.data.total) + ' n=' + ((j.data && j.data.results) || []).length + ' titles=' + ((j.data && j.data.results) || []).map(c => c.title).join('|').slice(0, 300); } catch (e) {}
    }
  });
  const box = page.getByPlaceholder('请输入知识内容进行搜索');
  for (const kw of ['噪音', '感觉辣刺鼻', '辣']) {
    await box.fill(kw);
    await page.waitForTimeout(300);
    await box.press('Enter');
    await page.waitForTimeout(4000);
    console.log(kw, '=>', lastResp.slice(0, 400));
  }
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
