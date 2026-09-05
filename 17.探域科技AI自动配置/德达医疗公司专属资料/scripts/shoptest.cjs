const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async () => {
    const mk = (t, kt) => fetch('/api/kbe/v1/knowledge-card/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ title: t, content: [{ content: '测试标记:' + t + '，香蕉苹果西瓜测试。' }], labels: [], ifBelievable: true, knowledgeType: kt, ifOpen: true }) }).then(r => r.text()).then(t => t.slice(0, 50));
    return JSON.stringify([await mk('测试/香蕉测试全店', 'SHOP'), await mk('测试/香蕉测试聊天', 'CHAT')]);
  });
  console.log('SAVED', r);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
