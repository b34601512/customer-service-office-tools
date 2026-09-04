const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async () => {
    const pg = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 3000 }), credentials: 'include' })).json();
    const rs = (pg.data && pg.data.results) || [];
    const txt = c => (c.title || '') + ' ' + (c.content || []).map(x => x.content).join(' ');
    const groups = {
      feng: ['拆封后拒绝退货', '拆封就不支持退货', '拆封后不支持退货', '一经拆封就不支持'],
      beiyong: ['备用机这边可以安排', '备用机仅限', '1499元押金', '备用机收费标准', '备用机押金', '备用机都', '买备用机', '免费使用30天', '免费试用服务', '备用机简短流程', '联系下机器上专门负责这类问题'],
      y300w45: ['额外赠送了第4档和第5档位', '赠送了第4档'],
      l807: ['1L：90%']
    };
    const out = {};
    for (const [k, pats] of Object.entries(groups)) out[k] = rs.filter(c => pats.some(t => txt(c).includes(t))).map(c => ({ id: c.id, t: c.title }));
    return JSON.stringify(out, null, 1);
  });
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/fix5-list.txt', r, 'utf8');
  console.log(r);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
