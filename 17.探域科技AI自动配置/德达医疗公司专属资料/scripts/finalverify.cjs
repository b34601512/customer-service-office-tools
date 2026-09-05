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
    const bad = ['自营店/换货','自营店/退货','自营店/维修','自营店/补发','自营店/特殊申请','自营店/服务','自营店/货到付款','延保/京东','拼多多/协商修改','拼多多/退货','拼多多/先用后付','拼多多/差价','拼多多/发货','平台介入点名','收款账号','公司发票信息','备注话术/撕单','备注话术/收到退货','备注话术/ERP已作废','付款10分钟内仅退款','HW02进水器','提醒话术/测试','拒绝话术/没有','拒绝话术/没承诺','外仓审单','非话术','春假','安抚公式','投诉处理原则','高危售后','全国运动会','保价618','打火机为什么不能做','京东自营店售后政策','192.168','90天只换不修','大爱清尘','仅退款流程'];
    const left = bad.filter(b => rs.some(c => txt(c).includes(b)));
    const all = rs.map(c => c.id + '\t' + (c.title || '') + '\t' + (c.content || []).map(x => x.content).join(' ').replace(/[\r\n]+/g, ' ').slice(0, 200));
    return JSON.stringify({ total: pg.data.total, n: rs.length, left, all });
  });
  const o = JSON.parse(r);
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/kb-final.txt', o.all.join('\n'), 'utf8');
  console.log('total=' + o.total + ' n=' + o.n + ' left=' + JSON.stringify(o.left));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
