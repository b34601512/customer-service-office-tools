const fs=require('fs');
const {chromium}=require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const dir='D:/备份文件夹/探域问答审核-20260905';
(async()=>{const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});try{
 const page=ctx.pages()[0]||await ctx.newPage();
 if(process.argv[2]==='headers')page.on('request',r=>{if(r.url().includes('knowledge-card/page'))console.log(JSON.stringify({url:r.url(),body:r.postData(),headers:Object.fromEntries(Object.entries(r.headers()).filter(([k])=>!/cookie|authorization|token|session/i.test(k)))}));});
 await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base',{waitUntil:'domcontentloaded'});
 if(process.argv[2]==='headers'){await page.waitForTimeout(3000);return;}
 const scripts=await page.locator('script[src]').evaluateAll(es=>es.map(e=>e.src));
 if(process.argv[2]==='products'){
  const products=await page.evaluate(async()=>{const r=await fetch('/api/kbe/v1/knowledge-product/product-paginate',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageIndex:1,pageSize:100,needDetail:true,thirdShopIds:['2095398963959042048']})});const j=await r.json();if(j.code!==1)throw Error('商品读取失败');return j.data;});
  fs.writeFileSync(dir+'/image-binding-products-detailed.json',JSON.stringify(products,null,2));console.log(JSON.stringify(products.results.map(p=>({spuId:p.spuId,outerId:p.outerId,skus:p.skus.map(s=>({skuId:s.skuId,attrs:s.attrs}))}))));return;
 }
 const assets=[];for(const url of scripts){if(!url.includes('/assets/'))continue;const r=await page.request.get(url);const src=await r.text();if(src.includes('get-upload-tokens')){fs.writeFileSync(dir+'/image-binding-current-bundle.js',src);assets.push({url,length:src.length});}}
 console.log(JSON.stringify({scripts,assets}));
 const all=await page.evaluate(async()=>{const r=await fetch('/api/kbe/v1/knowledge-card/page',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageNo:1,pageSize:3000})});const j=await r.json();if(j.code!==1)throw Error('读取失败');return j.data.results;});
 fs.writeFileSync(dir+'/image-binding-before.json',JSON.stringify(all,null,2));
 console.log(JSON.stringify({total:all.length,images:all.filter(c=>c.ifOpen&&c.content.some(x=>/!\[.*?\]\(|<img/.test(x.content))).slice(0,3).map(c=>({id:c.id,content:c.content}))}));
}finally{await ctx.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
