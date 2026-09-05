const { chromium } = require('playwright-core');
const fs = require('fs');
const lines = fs.readFileSync('C:/Users/b3460/.pi-edge-work/price-list.txt', 'utf8').split('\n').filter(Boolean);
const keepPats = ['运费/', '发票/', '发货/发错货/制氧机发错货核实', '发货/发错货/漏发', 'A1L买9升发成7升', '氧气瓶退货才能退款', '氧气瓶直接仅退款', '要是不好用你们怎么退', '客户要求赔偿回应', '前流/交接/2.晚班', '3.超额补偿客户损失/顺丰包邮', '一小时多少度电', '电源用我们制氧机能用多长时间', '没有血氧仪怎么判断', '价格/国补通用话术/国补订单可以改地址吗？', '透明吸氧管异味', '散热口有味道', '后流/后台处理/赠品驳回', '延保/天猫延长保修/天猫延保服务是干什么', '延保/天猫延长保修/怎么发起延保', '延保/天猫延长保修/延保什么时候开始', '延保/天猫延长保修/延保能保多长时间', '延保/天猫延长保修/延保是谁提供', '延保/天猫延长保修/延保主要保哪些', '延保/天猫延长保修/摔坏、进水', '延保/天猫延长保修/延保服务是维修还是换新', '延保/天猫延长保修/延保是上门维修', '延保/天猫延长保修/申请延保维修需要什么条件', '延保/天猫延长保修/购买延保有发票', '延保/天猫延长保修/商品修不好怎么办', '延保/天猫延长保修/换机会换同型号', '延保/天猫延长保修/原型号没有库存', '延保/天猫延长保修/我自己改时间或地址', '延保/天猫延长保修/不可抗力', '延保/天猫延长保修/哪些情况属于不可抗力', '延保/天猫延长保修/恶意套取', '延保/天猫延长保修/对延保服务不满意'];
const keep = [], del = [];
for (const ln of lines) {
  const id = ln.split('\t')[0];
  const title = ln.split('\t')[1] || '';
  (keepPats.some(p => title.includes(p)) ? keep : del).push(ln);
}
fs.writeFileSync('C:/Users/b3460/.pi-edge-work/price-keep.txt', keep.join('\n'), 'utf8');
console.log('KEEP=' + keep.length + ' DEL=' + del.length);
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const ids = del.map(l => l.split('\t')[0]);
  const r = await page.evaluate(async (ids) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const res = await fetch('/api/kbe/v1/knowledge-card/batch-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardIds: ids.slice(i, i + 50) }), credentials: 'include' });
      out.push(res.status + ':' + (await res.text()).slice(0, 60));
    }
    const pg = await (await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 3000 }), credentials: 'include' })).json();
    return JSON.stringify({ resp: out, total: pg.data.total, n: (pg.data.results || []).length });
  }, ids);
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/pricedel-result.txt', r, 'utf8');
  console.log(r);
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
