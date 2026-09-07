const fs=require('fs');const {chromium}=require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const dir='D:/备份文件夹/探域问答审核-20260905';
const base={thirdShopId:'2095398963959042048',beginTime:'2026-08-08 00:00:00',endTime:'2026-09-07 23:59:59'};
(async()=>{const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});try{
const p=ctx.pages()[0]||await ctx.newPage();await p.goto('http://agent.tanyuai.com/v2/diagnostic-optimization/optimization-workshop',{waitUntil:'domcontentloaded'});
const req=(url,data)=>p.evaluate(async({url,data})=>{const r=await fetch(url,{method:data?'POST':'GET',credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(25000)});const j=await r.json();if(!r.ok||j.code!==1)throw Error('读取失败');return j.data;},{url,data});
const all=[];for(let n=1;;n++){const r=await req('/api/im/agent-trace/paginateV2',{...base,pageIndex:n,pageSize:200});all.push(...r.results);if(all.length>=r.total)break;if(!r.results.length)throw Error('分页不完整');}
const labels=await req('/api/im/agent-trace/no-send-reason-list');const groups=[];
for(const label of labels){const rows=[];let total=0;for(let n=1;;n++){const r=await req('/api/im/agent-trace/paginateV2',{...base,pageIndex:n,pageSize:200,noSendReasonList:[label.value]});total=r.total;rows.push(...r.results);if(rows.length>=total)break;if(!r.results.length)throw Error('分页不完整');}groups.push({...label,total,rows});}
const result={time:new Date().toISOString(),base,all,groups,details:[]};const file=dir+'/risk-analysis-20260907.json';fs.writeFileSync(file,JSON.stringify(result,null,2));console.log('groups',JSON.stringify(groups.map(({value,label,total})=>({value,label,total}))));
const ids=[...new Set(groups.filter(g=>[102,103,116,121,122,106,123].includes(g.value)).flatMap(g=>g.rows.map(r=>r.id)))];
for(let i=0;i<ids.length;i+=4){const batch=await Promise.all(ids.slice(i,i+4).map(async id=>({id,trace:await req('/api/im/agent-trace/trace',{cardId:id,thirdShopId:base.thirdShopId}),context:await req('/api/im/agent-trace/get-card-chat-context?thirdShopId='+base.thirdShopId+'&cardId='+id)})));result.details.push(...batch);fs.writeFileSync(file,JSON.stringify(result,null,2));}
console.log(JSON.stringify({total:all.length,unique:new Set(all.map(r=>r.id)).size,details:result.details.length,file}));
}finally{await ctx.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
