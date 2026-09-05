// 仅更新原卡；不删除、不新增、不改变类型或店铺/SKU/订单阶段。
// node ...cjs apply | verify | restore
const fs=require('fs');
const {chromium}=require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const B='D:/备份文件夹/探域问答审核-20260905';
const plan=require(B+'/planned-changes.json');
const mode=process.argv[2]||'verify';
const only=process.argv[3]?new Set(process.argv[3].split(',').map(Number)):null;
const workPlan=only?plan.filter(x=>only.has(x.index)):plan;
if(!['apply','verify','restore'].includes(mode))throw Error('仅支持apply/verify/restore');
const fields=['id','title','content','labels','ifBelievable','type','ifOpen','includeCondition','excludeCondition','timeliness','cycleTimeliness','orderStatus'];
const preserve=['type','labels','ifBelievable','includeCondition','excludeCondition','timeliness','cycleTimeliness','orderStatus','source','productCondition','ifOpenSync','ifHasUrl','urlInfos'];
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const body=c=>(c.content||[]).map(p=>p.content);
// 服务端把“无排除条件”的六个null规范化为空数组；只认可这一种观察到的等价变化。
const conditionKeys=['spu','shop','rules','productGroupId','sellerGroup','platform'];
const value=(k,v)=>k==='excludeCondition'&&v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([n,x])=>[n,conditionKeys.includes(n)&&x===null?[]:x])):v;
const norm=c=>Object.fromEntries(fields.map(k=>[k,k==='content'?body(c):value(k,c[k])]));
const same=(a,b)=>stable(norm(a))===stable(norm(b));
const payload=c=>Object.fromEntries(fields.map(k=>[k,k==='content'?(c.content||[]).map(x=>({content:x.content})):c[k]]));
const approvedStageFix=new Set([219,544,813]);
for(const x of plan){for(const k of preserve)if(stable(x.before[k])!==stable(x.after[k])&&!(k==='orderStatus'&&approvedStageFix.has(x.index)&&stable(x.after.orderStatus)===stable(['PRE_SALE','SALE','AFTER_SALE'])))throw Error('计划越界 '+x.id+' '+k);if(x.before.ifOpen===false&&x.after.ifOpen!==false)throw Error('不能启用原停用卡');}
(async()=>{
 const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});
 const journalPath=B+'/execution-journal.json';
 const journal=fs.existsSync(journalPath)?JSON.parse(fs.readFileSync(journalPath,'utf8')):{startedAt:new Date().toISOString(),entries:[]};
 const save=()=>fs.writeFileSync(journalPath,JSON.stringify(journal,null,2));
 try{
 const page=ctx.pages()[0]||await ctx.newPage();
 await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForTimeout(4500);
 const request=async(url,data)=>page.evaluate(async({url,data})=>{const r=await fetch(url,{method:data?'POST':'GET',credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok||j.code!==1)throw Error(url+' HTTP '+r.status+' code '+j.code+' '+j.msg);return j.data;},{url,data});
 const fetchAll=async()=>{const a=(await request('/api/kbe/v1/knowledge-card/page',{pageNo:1,pageSize:3000})).results;if(!Array.isArray(a)||a.length<1900||new Set(a.map(c=>c.id)).size!==a.length)throw Error('全量读取保护失败');return a;};
 const detail=id=>request('/api/kbe/v1/knowledge-card/detail?id='+encodeURIComponent(id));
 const write=c=>request('/api/kbe/v1/knowledge-card/update',payload(c));
 const beforeAll=await fetchAll();
 fs.writeFileSync(B+'/'+mode+'-before-'+Date.now()+'.json',JSON.stringify(beforeAll,null,2));
 const beforeMap=new Map(beforeAll.map(c=>[c.id,c]));
 if(mode==='apply'){
   // Canary完整往返：先写确定错字，再恢复原文，验证范围及来源字段可保留。
   if(!journal.canaryPassed){
    const x=plan.find(x=>x.index===745);const c=await detail(x.id);
    if(!same(c,x.before))throw Error('Canary前置内容发生变化');
    journal.canary={id:c.id,before:c,stage:'before'};save();
    await write(x.after);const saved=await detail(c.id);
    if(!same(saved,x.after))throw Error('Canary写入内容不一致，停止批量');
    for(const k of preserve)if(stable(c[k])!==stable(saved[k]))throw Error('Canary来源/范围变化 '+k);
    journal.canary.stage='applied';save();
    await write(c);const restored=await detail(c.id);
    if(!same(restored,c))throw Error('Canary恢复失败，停止批量');
    for(const k of preserve)if(stable(c[k])!==stable(restored[k]))throw Error('Canary恢复字段异常 '+k);
    journal.canaryPassed=true;journal.canary.stage='roundtrip-verified';save();console.log('Canary原文/范围/来源恢复核验通过');
   }
   let cursor=0,done=0;
   async function worker(){while(cursor<workPlan.length){const x=workPlan[cursor++];const previous=journal.entries.findLast(e=>e.id===x.id&&e.status==='applied');
     try{
       const c=await detail(x.id);
       if(same(c,x.after)){if(!previous)journal.entries.push({id:x.id,index:x.index,status:'already-matches',time:new Date().toISOString()});}
       else if(!same(c,x.before)&&!(previous&&same(c,previous.after))){journal.entries.push({id:x.id,index:x.index,status:'conflict-skipped',current:c,time:new Date().toISOString()});}
       else{
         const entry={id:x.id,index:x.index,status:'prepared',before:c,after:x.after,time:new Date().toISOString()};journal.entries.push(entry);save();
         await write(x.after);entry.status='applied';entry.appliedAt=new Date().toISOString();
       }
     }catch(e){journal.entries.push({id:x.id,index:x.index,status:'error-no-blind-retry',error:e.message,time:new Date().toISOString()});}
     save();done++;if(done%25===0||done===workPlan.length)console.log('进度 '+done+'/'+workPlan.length);
   }}
   await Promise.all([worker(),worker(),worker()]);
 }
 if(mode==='restore'){
   for(const e of journal.entries.filter(e=>e.status==='applied').reverse()){
     const c=await detail(e.id);if(same(c,e.before)){e.restore='already-original';continue;}
     if(!same(c,e.after)){e.restore='conflict-skipped';save();continue;}
     await write(e.before);const restored=await detail(e.id);e.restore=same(restored,e.before)?'restored':'verify-failed';save();
   }
 }
 const afterAll=await fetchAll();fs.writeFileSync(B+'/'+mode+'-after-'+Date.now()+'.json',JSON.stringify(afterAll,null,2));
 const afterMap=new Map(afterAll.map(c=>[c.id,c]));const mismatches=[],scopeChanges=[],unexpected=[],emptyConditionNormalizations=[];
 for(const x of plan){const c=afterMap.get(x.id);if(!c||!same(c,mode==='restore'?x.before:x.after))mismatches.push(x.id);if(c)for(const k of preserve)if(stable(x.before[k])!==stable(c[k])){if(k==='orderStatus'&&approvedStageFix.has(x.index)&&mode!=='restore'&&stable(c[k])===stable(x.after[k]))continue;if(stable(value(k,x.before[k]))===stable(value(k,c[k])))emptyConditionNormalizations.push({id:x.id,field:k});else scopeChanges.push({id:x.id,field:k});}}
 const changedIds=new Set(plan.map(x=>x.id));
 for(const c of afterAll){const old=beforeMap.get(c.id);if(old&&!changedIds.has(c.id)&&!same(c,old))unexpected.push(c.id);}
 const report={mode,time:new Date().toISOString(),beforeCount:beforeAll.length,afterCount:afterAll.length,planCount:plan.length,matched:plan.length-mismatches.length,mismatches,scopeChanges,emptyConditionNormalizations,unexpected,added:afterAll.filter(c=>!beforeMap.has(c.id)).map(c=>c.id),missing:beforeAll.filter(c=>!afterMap.has(c.id)).map(c=>c.id),learning:afterAll.filter(c=>changedIds.has(c.id)&&c.ifLearning).map(c=>c.id),statuses:journal.entries.reduce((a,e)=>(a[e.status]=(a[e.status]||0)+1,a),{})};
 fs.writeFileSync(B+'/'+mode+'-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(mismatches.length||scopeChanges.length||unexpected.length||report.missing.length)process.exitCode=1;
 }finally{await ctx.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
