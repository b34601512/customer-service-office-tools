const fs=require('fs'),crypto=require('crypto'),path=require('path');
const {chromium}=require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const dir='D:/备份文件夹/探域问答审核-20260905';
const plan=JSON.parse(fs.readFileSync(dir+'/image-binding-plan.json','utf8'));
const uploads=JSON.parse(fs.readFileSync(dir+'/image-binding-uploads.json','utf8')).filter(u=>u.status==='uploaded');
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
(async()=>{const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});try{
 const page=ctx.pages()[0]||await ctx.newPage();await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base',{waitUntil:'domcontentloaded'});
 const req=(url,data)=>page.evaluate(async({url,data})=>{const r=await fetch(url,{method:data?'POST':'GET',credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});const j=await r.json();if(j.code!==1)throw Error('请求失败 '+j.code);return j.data;},{url,data});
 let all=(await req('/api/kbe/v1/knowledge-card/page',{pageNo:1,pageSize:3000})).results;
 const result={time:new Date().toISOString(),before:all,duplicates:[],cards:[],images:[]};
 const out=dir+'/image-binding-verification-'+Date.now()+'.json';const save=()=>fs.writeFileSync(out,JSON.stringify(result,null,2));save();
 // Only the exact duplicate created by this task; preserve a full copy, disable rather than delete.
 const duplicate=all.find(c=>c.id==='6a9c02a64a45121da4d82790'),keep=all.find(c=>c.id==='6a9c025b644e354d71a45c8d');
 if(duplicate?.ifOpen&&keep?.ifOpen){if(duplicate.title!==keep.title||duplicate.content.map(x=>x.content).join('\n')!==keep.content.map(x=>x.content).join('\n')||stable(duplicate.includeCondition)!==stable(keep.includeCondition))throw Error('重复卡保护失败');
  const before=await req('/api/kbe/v1/knowledge-card/detail?id='+duplicate.id);if(before.content.map(x=>x.content).join('\n')!==duplicate.content.map(x=>x.content).join('\n'))throw Error('重复卡并发保护');
  result.duplicates.push({before,status:'prepared'});save();const fields=['id','title','content','labels','ifBelievable','type','ifOpen','includeCondition','excludeCondition','timeliness','cycleTimeliness','orderStatus'];
  const payload=Object.fromEntries(fields.map(k=>[k,k==='ifOpen'?false:before[k]]));await req('/api/kbe/v1/knowledge-card/update',payload);
  const after=await req('/api/kbe/v1/knowledge-card/detail?id='+duplicate.id);if(after.ifOpen)throw Error('停用未成功');result.duplicates[0].after=after;result.duplicates[0].status='verified';save();
 }
 all=(await req('/api/kbe/v1/knowledge-card/page',{pageNo:1,pageSize:3000})).results;
 for(const p of plan){const c=p.id?all.find(c=>c.id===p.id):all.find(c=>c.ifOpen&&c.title===p.title);const content=p.text+(p.files.length?'\n\n'+p.files.map(file=>'!['+path.basename(file,'.png')+']('+uploads.find(u=>u.file===file).url+')').join('\n\n'):'');result.cards.push({id:c?.id,title:p.title,ok:!!c&&c.ifOpen&&c.content.map(x=>x.content).join('\n')===content&&stable(c.includeCondition)===stable(p.includeCondition),boundProducts:c?.includeCondition.spu.length,images:p.files.length,learning:c?.ifLearning});}
 for(const u of uploads){const r=await page.request.get(u.url);const bytes=await r.body();result.images.push({file:u.file,url:u.url,status:r.status(),hashMatches:crypto.createHash('sha256').update(bytes).digest('hex')===u.sha256});}
 result.final=all;save();console.log(JSON.stringify({file:out,cards:result.cards.length,mismatches:result.cards.filter(c=>!c.ok),images:result.images.length,imageErrors:result.images.filter(i=>i.status!==200||!i.hashMatches),disabledDuplicates:result.duplicates.length}));
}finally{await ctx.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
