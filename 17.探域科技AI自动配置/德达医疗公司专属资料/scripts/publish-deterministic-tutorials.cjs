const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {chromium}=require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const root=path.resolve(__dirname,'..'),dir='D:/备份文件夹/探域问答审核-20260905';
const config=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):null;
const prefix=config?.prefix||'deterministic-tutorials-20260905';
if(!/^[a-z0-9-]+$/.test(prefix))throw Error('非法前缀');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,null,2));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const body=c=>c.content.map(x=>x.content).join('\n');
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const fields=['id','title','content','labels','ifBelievable','type','ifOpen','includeCondition','excludeCondition','timeliness','cycleTimeliness','orderStatus'];
const metadata=c=>Object.fromEntries(fields.filter(k=>k!=='content').map(k=>[k,k==='excludeCondition'?Object.fromEntries(Object.entries(c[k]||{}).map(([a,b])=>[a,b===null?[]:b])):c[k]]));
const ids={C1:'6a9a3c474a45121da4d7c7e9',Y105Y106:'6a9a3c474a45121da4d7c7f2','1A':'6a9a3c474a45121da4d7c7e5','1LW':'6a9a3c47644e354d71a3f9c6','1SW':'6a9a3c47644e354d71a3f9c8',A1:'6a9a3c474a45121da4d7c7e6',Q3L:'6a9a3c47644e354d71a3f9cd',Q5L:'6a9a3c474a45121da4d7c7f0',Q10L:'6a9a3c47644e354d71a3f9d0',Y300W:'6a9a3c474a45121da4d7c7ec',Y5W:'6a9a3c47644e354d71a3f9d4'};
const images=config?read(config.manifest):read(root+'/output/教程修订版-20260905/manifest.json').filter(x=>ids[x.model]||['MY-5C','YS-8Y'].includes(x.model));
const snapshot=read(dir+'/'+prefix+'-before.json');
const logFile=dir+'/'+prefix+'-publish.json';
const log=fs.existsSync(logFile)?read(logFile):{uploads:[],entries:[]};
const save=()=>write(logFile,log);
(async()=>{const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});try{
 const page=ctx.pages()[0]||await ctx.newPage();await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base',{waitUntil:'domcontentloaded'});
 const req=(url,data)=>page.evaluate(async({url,data})=>{const r=await fetch(url,{method:data?'POST':'GET',credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok||j.code!==1)throw Error('请求失败 '+r.status+' '+j.code);return j.data;},{url,data});
 const all=()=>req('/api/kbe/v1/knowledge-card/page',{pageNo:1,pageSize:3000}).then(x=>x.results);
 if(process.argv[2]==='verify'){
  const cards=await all();const checks=[];
  for(const e of log.entries){const c=e.before?await req('/api/kbe/v1/knowledge-card/detail?id='+e.before.id):cards.find(c=>c.title===e.payload.title);
   checks.push({title:e.payload.title,id:c?.id,contentMatches:!!c&&body(c)===body(e.payload),metadataMatches:!!c&&stable(metadata({...c,id:undefined}))===stable(metadata({...e.payload,id:undefined})),learning:c?.ifLearning});}
  const remote=[];for(const u of log.uploads){const r=await page.request.get(u.url);remote.push({model:u.model,status:r.status(),sha256Matches:hash(await r.body())===u.sha256});}
  const result={time:new Date().toISOString(),checks,remote};write(dir+'/'+prefix+'-verification.json',result);console.log(JSON.stringify(result));return;
 }
 const src=await page.locator('script[src]').evaluateAll(es=>es.map(e=>e.src).find(s=>s.includes('/assets/index-')));
 const bundle=await(await page.request.get(src)).text();if(!bundle.includes('vme as aJ')||!bundle.includes('copilot-knowledge-base'))throw Error('上传模块变化');
 for(const im of images){
  if(!im.outsidePixelsUnchanged||hash(fs.readFileSync(im.source))!==im.sourceSha256||hash(fs.readFileSync(im.file))!==im.sha256)throw Error('图片校验失败 '+im.model);
  let u=log.uploads.find(x=>x.model===im.model&&x.sha256===im.sha256);
  if(!u){const out=await page.evaluate(async({src,data,name})=>{const {aJ:uploader}=await import(src);const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const r=await uploader.multipartUpload(name,new Blob([bytes],{type:'image/png'}),undefined,'copilot');const url=new URL(r.res.requestUrls[0]);return {url:url.origin+url.pathname};},{src,data:fs.readFileSync(im.file).toString('base64'),name:Date.now()+'-'+crypto.randomUUID()+'.png'});u={model:im.model,file:im.file,sha256:im.sha256,...out};log.uploads.push(u);save();}
  let e=log.entries.find(e=>e.model===im.model);
  if(e){console.log('已有提交记录，请通过verify核实 '+im.model);continue;}
  const target=config?.targets[im.model];
  if(config&&!target)throw Error('缺少目标 '+im.model);
  const id=config?target.id:ids[im.model];let before=null,payload;
  if(id){before=await req('/api/kbe/v1/knowledge-card/detail?id='+id);const expected=snapshot.find(c=>c.id===id);
   if(!expected||!before.ifOpen||body(before)!==body(expected)||stable(metadata(before))!==stable(metadata(expected)))throw Error('并发修改保护 '+im.model);
   if(body(before).includes('![')&&!target?.allowAppend)throw Error('已有图片，请人工检查 '+im.model);
   payload=Object.fromEntries(fields.map(k=>[k,before[k]]));
  }else{const title=target?.title||'使用教程/便携制氧机使用方法/'+im.model+'使用方法操作图示';
   // Reviewed MY-5C existing settings/battery/charging cards: none covers startup/port diagram.
   if((await all()).some(c=>c.title===title||(/使用教程/.test(c.title)&&c.title.includes(im.model)&&/开机|接管|操作图示|使用方法操作/.test(c.title))))throw Error('已有开机教程，请重新核对 '+im.model);
   payload={title,type:'SHOP',ifOpen:true,ifBelievable:true,labels:[],includeCondition:{spu:[],shop:[{thirdShopId:'2095398963959042048',cids:[]}],rules:[],productGroupId:[],sellerGroup:[],platform:[]},excludeCondition:{spu:[],shop:[],rules:[],productGroupId:[],sellerGroup:[],platform:[]},orderStatus:['AFTER_SALE'],timeliness:null,cycleTimeliness:null};
  }
  if(!before&&target?.scopeFromId){const scope=snapshot.find(c=>c.id===target.scopeFromId);if(!scope||!scope.includeCondition.spu.length)throw Error('缺商品绑定依据');payload.includeCondition=scope.includeCondition;}
  const text=before?body(before):(target?.text||`Q:${im.model}怎么使用？\nA:请先核对铭牌型号为${im.model}，且面板、接口与图示一致；不一致时请发铭牌和面板照片由我们匹配。将鼻吸管接图示吸氧接口，长按电源键开机。按医生确定的档位及用氧要求使用；未明确用氧要求时先咨询医生。`);
  payload.content=[{content:text+'\n\n!['+(target?.alt||im.model+'使用方法图示')+']('+u.url+')',chunkLength:text.length}];
  e={model:im.model,before,payload,status:'prepared'};log.entries.push(e);save();
  e.response=await req('/api/kbe/v1/knowledge-card/'+(id?'update':'save'),payload);e.status=id?'saved':'submitted-awaiting-index';save();
  if(id){e.after=await req('/api/kbe/v1/knowledge-card/detail?id='+id);if(body(e.after)!==body(payload)||stable(metadata(e.after))!==stable(metadata(payload)))throw Error('回读不一致 '+im.model);e.status='verified';save();}
  console.log('已保存 '+im.model);
 }
}finally{await ctx.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
