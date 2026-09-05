const fs = require('fs');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const dir = 'D:/备份文件夹/探域问答审核-20260905';
(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', {channel:'msedge',headless:true});
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(5000);
    const data = await page.evaluate(async () => {
      const out = {};
      for (const [key,url,body] of [
        ['cards','/api/kbe/v1/knowledge-card/page',{pageNo:1,pageSize:3000}],
        ['shops','/api/gc/agent-personal/getChatbotShopDetailPage?pageNo=1&pageSize=100'],
        ['groups','/api/copilot/product-group/group-list']]) {
        const r = await fetch(url,{method:body?'POST':'GET',credentials:'include',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
        if(!r.ok) throw new Error(key+' HTTP '+r.status);
        out[key] = await r.json();
      }
      return out;
    });
    if (!Array.isArray(data.cards?.data?.results) || !data.cards.data.results.length) throw new Error('登录态或数据不可用');
    const file = dir+'/snapshot-'+Date.now()+'.json';
    fs.writeFileSync(file,JSON.stringify(data,null,2));
    const cards = data.cards.data.results;
    fs.writeFileSync(dir+'/review.txt', cards.map((c,i)=>`\n[${i}] ${c.id} ${c.type} ${c.title||''}\n${(c.content||[]).map(x=>x.content).join('\n')}`).join('\n'));
    console.log(JSON.stringify({file,count:cards.length,types:cards.reduce((a,c)=>(a[c.type]=(a[c.type]||0)+1,a),{}),sample:cards[0],shops:data.shops,groups:data.groups}));
  } finally { await ctx.close(); }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
