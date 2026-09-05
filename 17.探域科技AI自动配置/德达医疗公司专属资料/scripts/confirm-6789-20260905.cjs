const fs=require('fs');
const {chromium}=require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const dir='D:/备份文件夹/探域问答审核-20260905';
const prefix=process.argv[3]||'confirmation-6789';
if(!/^[a-z0-9-]+$/.test(prefix))throw Error('非法备份前缀');
const fields=['id','title','content','labels','ifBelievable','type','ifOpen','includeCondition','excludeCondition','timeliness','cycleTimeliness','orderStatus'];
const body=c=>c.content.map(x=>x.content).join('\n');
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const cond=v=>Object.fromEntries(Object.entries(v||{}).map(([k,x])=>[k,x===null?[]:x]));
(async()=>{const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});try{
 const page=ctx.pages()[0]||await ctx.newPage();await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base',{waitUntil:'domcontentloaded'});
 const req=(url,data)=>page.evaluate(async({url,data})=>{const r=await fetch(url,{method:data?'POST':'GET',credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok||j.code!==1)throw Error('请求失败 '+r.status+' '+j.code);return j.data;},{url,data});
 const all=(await req('/api/kbe/v1/knowledge-card/page',{pageNo:1,pageSize:3000})).results;
 if(!Array.isArray(all)||all.length<2000)throw Error('全量读取异常');
 if(process.argv[2]==='verify'){
  const plan=JSON.parse(fs.readFileSync(dir+'/'+prefix+'-plan.json','utf8'));
  const result={time:new Date().toISOString(),total:all.length,mismatches:plan.filter(p=>body(all.find(c=>c.id===p.id))!==p.after).map(p=>p.id),learning:all.filter(c=>plan.some(p=>p.id===c.id)&&c.ifLearning).map(c=>c.id)};
  fs.writeFileSync(dir+'/'+prefix+'-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));return;
 }
 if(process.argv[2]!=='apply'){
  fs.writeFileSync(dir+'/'+prefix+'-before.json',JSON.stringify(all,null,2));
  const candidates=all.filter(c=>c.ifOpen&&/发票|收据|赠品|礼品|晒单|晒图|付邮|赠管|上门|旧.{0,5}(零部件|配件)|非本店|不是.{0,5}(买|购)|生产日期/.test((c.title||'')+'\n'+body(c)));
  fs.writeFileSync(dir+'/'+prefix+'-candidates.json',JSON.stringify(candidates,null,2));
  console.log(JSON.stringify({total:all.length,candidates:candidates.length}));return;
 }
 const plan=JSON.parse(fs.readFileSync(dir+'/'+prefix+'-plan.json','utf8'));
 const record={time:new Date().toISOString(),before:all,entries:[]};const file=dir+'/'+prefix+'-applied-'+Date.now()+'.json';
 fs.writeFileSync(file,JSON.stringify(record,null,2));
 for(const p of plan){
  const before=await req('/api/kbe/v1/knowledge-card/detail?id='+p.id);
  if(body(before)===p.after&&before.ifOpen&&before.type===p.type&&stable(before.includeCondition)===stable(p.includeCondition))continue;
  if(body(before)!==p.before||!before.ifOpen||before.type!==p.type||stable(before.includeCondition)!==stable(p.includeCondition))throw Error('并发变更/范围保护 '+p.id);
  const payload=Object.fromEntries(fields.map(k=>[k,k==='content'?[{content:p.after}]:before[k]]));
  const entry={id:p.id,before,payload,status:'prepared'};record.entries.push(entry);fs.writeFileSync(file,JSON.stringify(record,null,2));
  await req('/api/kbe/v1/knowledge-card/update',payload);
  const after=await req('/api/kbe/v1/knowledge-card/detail?id='+p.id);entry.after=after;
  if(body(after)!==p.after||!fields.filter(k=>!['content','excludeCondition'].includes(k)).every(k=>stable(before[k])===stable(after[k]))||stable(cond(before.excludeCondition))!==stable(cond(after.excludeCondition)))throw Error('回读不一致 '+p.id);
  entry.status='verified';fs.writeFileSync(file,JSON.stringify(record,null,2));
 }
 record.final=(await req('/api/kbe/v1/knowledge-card/page',{pageNo:1,pageSize:3000})).results;
 record.mismatches=plan.filter(p=>body(record.final.find(c=>c.id===p.id))!==p.after).map(p=>p.id);
 fs.writeFileSync(file,JSON.stringify(record,null,2));console.log(JSON.stringify({modified:record.entries.length,mismatches:record.mismatches,learning:record.final.filter(c=>plan.some(p=>p.id===c.id)&&c.ifLearning).length,file}));
}finally{await ctx.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
