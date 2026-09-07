const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {chromium}=require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const dir='D:/备份文件夹/探域问答审核-20260905';
const plan=JSON.parse(fs.readFileSync(dir+'/image-binding-plan.json','utf8'));
const fields=['id','title','content','labels','ifBelievable','type','ifOpen','includeCondition','excludeCondition','timeliness','cycleTimeliness','orderStatus'];
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const same=(a,b,keys)=>keys.every(k=>stable(a[k])===stable(b[k]));
const manifestPath=dir+'/image-binding-uploads.json';
const uploads=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):[];
(async()=>{const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});try{
 const page=ctx.pages()[0]||await ctx.newPage();await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base',{waitUntil:'domcontentloaded'});
 const req=(url,data)=>page.evaluate(async({url,data})=>{const r=await fetch(url,{method:data?'POST':'GET',credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok||j.code!==1)throw Error('请求失败 '+r.status+' '+j.code);return j.data;},{url,data});
 const all=()=>req('/api/kbe/v1/knowledge-card/page',{pageNo:1,pageSize:3000}).then(x=>x.results);
 if(process.argv[2]==='upload'){
  const src=await page.locator('script[src]').evaluateAll(es=>es.map(e=>e.src).find(s=>s.includes('/assets/index-')));
  const bundle=await(await page.request.get(src)).text();if(!bundle.includes('vme as aJ')||!bundle.includes('copilot-knowledge-base'))throw Error('上传模块变化');
  for(const file of [...new Set(plan.flatMap(p=>p.files))]){
   const bytes=fs.readFileSync(file),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
   if(uploads.some(x=>x.file===file&&x.sha256===sha256&&x.status==='uploaded'))continue;
   const item={file,sha256,status:'prepared'};uploads.push(item);fs.writeFileSync(manifestPath,JSON.stringify(uploads,null,2));
   const out=await page.evaluate(async({src,data,name})=>{const {aJ:uploader}=await import(src);const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const blob=new Blob([bytes],{type:'image/png'});const r=await uploader.multipartUpload(name,blob,undefined,'copilot');const url=new URL(r.res.requestUrls[0]);return{url:url.origin+url.pathname,name:r.name};},{src,data:bytes.toString('base64'),name:Date.now()+'-'+crypto.randomUUID()+'.png'});
   Object.assign(item,out,{status:'uploaded'});fs.writeFileSync(manifestPath,JSON.stringify(uploads,null,2));console.log('已上传 '+path.basename(file));
  }return;
 }
 const record={time:new Date().toISOString(),before:await all(),entries:[]};const journal=dir+'/image-binding-applied-'+Date.now()+'.json';
 const save=()=>fs.writeFileSync(journal,JSON.stringify(record,null,2));save();
 for(const p of (process.argv[2]==='probe-create'?[plan[4]]:plan)){
  const images=p.files.map(file=>{const u=uploads.find(x=>x.file===file&&x.status==='uploaded');if(!u)throw Error('未上传 '+file);return '!['+path.basename(file,'.png')+']('+u.url+')';});
  const content=p.text+(images.length?'\n\n'+images.join('\n\n'):'');
  const existing=p.id?record.before.find(c=>c.id===p.id):record.before.find(c=>c.title===p.title);
  if(existing&&existing.ifOpen&&existing.content.map(c=>c.content).join('\n')===content&&stable(existing.includeCondition)===stable(p.includeCondition)){console.log('已核实完成 '+p.title);continue;}
  const prior=fs.readdirSync(dir).filter(f=>/^image-binding-applied-/.test(f)).flatMap(f=>JSON.parse(fs.readFileSync(dir+'/'+f,'utf8')).entries||[]);
  if(!p.id&&!existing&&prior.some(e=>!e.before&&e.payload.title===p.title&&e.response===true)){console.log('已提交等待索引 '+p.title);continue;}
  let before=p.id?await req('/api/kbe/v1/knowledge-card/detail?id='+p.id):null;
  if(before&&!same(before,p.before,fields.filter(k=>k!=='content')))throw Error('并发字段变化 '+p.id);
  if(before&&before.content.map(c=>c.content).join('\n')!==p.before.content.map(c=>c.content).join('\n'))throw Error('并发正文变化 '+p.id);
  if(!p.id&&record.before.some(c=>c.title===p.title))throw Error('新卡重名');
  const payload=before?Object.fromEntries(fields.map(k=>[k,before[k]])):{title:p.title,type:'SHOP',ifOpen:true,ifBelievable:true,labels:[],excludeCondition:{spu:[],shop:[],rules:[],productGroupId:[],sellerGroup:[],platform:[]},orderStatus:['AFTER_SALE'],timeliness:null,cycleTimeliness:null};
  payload.includeCondition=p.includeCondition;payload.content=[{content,chunkLength:p.text.length}];
  const entry={before,payload,status:'prepared'};record.entries.push(entry);save();
  entry.response=await req('/api/kbe/v1/knowledge-card/'+(p.id?'update':'save'),payload);save();console.log('保存返回 '+JSON.stringify(entry.response));
  let after=p.id?await req('/api/kbe/v1/knowledge-card/detail?id='+p.id):(await all()).find(c=>c.title===p.title);
  entry.after=after;save();if(!after){entry.status='submitted-awaiting-index';save();console.log('已提交等待索引 '+p.title);continue;}
  if(after.content.map(c=>c.content).join('\n')!==content||!same(after,payload,['title','type','ifOpen','ifBelievable','includeCondition','orderStatus']))throw Error('回读失败 '+p.title);
  entry.status='verified';save();console.log('已保存 '+p.title);
 }
 record.final=await all();record.mismatches=record.entries.filter(e=>{const c=e.after?record.final.find(c=>c.id===e.after.id):record.final.find(c=>c.title===e.payload.title);return !c||!same(c,e.payload,['title','includeCondition','orderStatus'])||c.content.map(x=>x.content).join('\n')!==e.payload.content[0].content;}).map(e=>e.payload.title);save();
 console.log(JSON.stringify({journal,updated:record.entries.filter(e=>e.before).length,created:record.entries.filter(e=>!e.before).length,images:uploads.length,mismatches:record.mismatches}));
}finally{await ctx.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
