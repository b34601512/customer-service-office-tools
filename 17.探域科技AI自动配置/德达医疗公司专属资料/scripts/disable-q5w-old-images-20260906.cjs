const fs=require('fs');
const {chromium}=require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const dir='D:/备份文件夹/探域问答审核-20260905';
const targets={'6a9a30cfd9b5540ca9f5c5a4':'ae26279f-e22e-47d8-b13f-f43b0c81c9f5.jpeg','6a9a30cfd9b5540ca9f5c59d':'dc548286-5058-4776-8ec0-ce0658032a13.jpeg'};
const snapshot=JSON.parse(fs.readFileSync(dir+'/battery-separate-20260906-before.json','utf8'));
const fields=['id','title','content','labels','ifBelievable','type','ifOpen','includeCondition','excludeCondition','timeliness','cycleTimeliness','orderStatus'];
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const norm=(k,v)=>k==='content'?v.map(x=>x.content):k==='excludeCondition'?Object.fromEntries(Object.entries(v||{}).map(([k,x])=>[k,x===null?[]:x])):v;
(async()=>{const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});try{
 const page=ctx.pages()[0]||await ctx.newPage();await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base',{waitUntil:'domcontentloaded'});
 const req=(url,data)=>page.evaluate(async({url,data})=>{const r=await fetch(url,{method:data?'POST':'GET',credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok||j.code!==1)throw Error('请求失败');return j.data;},{url,data});
 const journal={time:new Date().toISOString(),entries:[]};const file=dir+'/q5w-old-images-disabled-'+Date.now()+'.json';
 for(const [id,url] of Object.entries(targets)){
  const c=await req('/api/kbe/v1/knowledge-card/detail?id='+id);const planned=snapshot.find(x=>x.id===id);
  if(!fields.filter(k=>k!=='ifOpen').every(k=>stable(norm(k,c[k]))===stable(norm(k,planned[k]))))throw Error('并发变更 '+id);
  if(!c.ifOpen){journal.entries.push({id,before:planned,after:c,status:'already-disabled-verified'});fs.writeFileSync(file,JSON.stringify(journal,null,2));continue;}
  if(c.type!=='PRODUCT'||c.includeCondition.spu.length!==1||c.includeCondition.spu[0].thirdShopId!=='2095398963959042048'||c.includeCondition.spu[0].spuId!=='557370224809'||!JSON.stringify(c.content).includes(url))throw Error('范围不符');
  const payload=Object.fromEntries(fields.map(k=>[k,k==='ifOpen'?false:c[k]]));const entry={id,before:c,payload,status:'prepared'};journal.entries.push(entry);fs.writeFileSync(file,JSON.stringify(journal,null,2));
  await req('/api/kbe/v1/knowledge-card/update',payload);const after=await req('/api/kbe/v1/knowledge-card/detail?id='+id);entry.after=after;
  if(after.ifOpen||!fields.filter(k=>k!=='ifOpen').every(k=>stable(norm(k,after[k]))===stable(norm(k,c[k]))))throw Error('回读不一致');
  entry.status='verified';fs.writeFileSync(file,JSON.stringify(journal,null,2));
 }
 console.log(JSON.stringify({disabled:journal.entries.length,file}));
}finally{await ctx.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
