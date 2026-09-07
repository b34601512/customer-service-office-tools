const fs=require('fs');
const {chromium}=require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const B='D:/备份文件夹/探域问答审核-20260907-pre-sale-after-sale-policy';
const CARD='6a9a3c4f644e354d71a3fb40';
const SHOP='2095398963959042048';
const AGENTS=['6a9e263e34c0ab0f8e1c0999','6a9a628fa56a287c9018754f'];
const RULE=`【运费承担原则】
本店运费责任按业务事实和购买时间判断，不因客户尚未提供订单号就拒绝解释政策：
1. 买家原因（无理由退货、拒收、拦截包裹、使用不当等）产生的退回运费，由买家承担。
2. 商品本身有问题，购买1年内由本店承担寄回及寄回后的来回运费；购买超过1年，寄回及寄回后的来回运费均由买家承担。
3. 本店承担的运费范围限中国大陆；海外及港澳台地区超出部分由买家承担。
售前了解政策时，直接说明上述原则；处理具体订单、判断责任或核对购买时间时，再根据订单和实际情况核实。不得把“需要订单核实”扩大成“没有订单号就不能说明政策”，也不得在未核实具体订单前承诺已登记、已付款或具体金额。`;
const AGENT_RULE=`【业务原则：售前了解售后政策】
售前、售中、售后按真实交易状态和业务事实理解，不按单个关键词或固定问法机械分流。客户尚未形成具体售后处理事项时，询问售后政策属于正常政策咨询，应直接说明已确认的规则，不因缺少订单号而拒绝解释。订单号仅用于核对具体订单、购买时间、商品责任和实际处理进度；进入具体订单处理后再要求提供。

运费承担原则：买家原因（无理由退货、拒收、拦截包裹、使用不当等）退回运费由买家承担；商品本身有问题且购买1年内，寄回及寄回后的来回运费由本店承担；购买超过1年，来回运费由买家承担；本店承担范围限中国大陆，海外及港澳台超出部分由买家承担。不得在未核实具体订单前承诺已登记、已付款或具体金额。`;
const body=c=>(c.content||[]).map(x=>x.content).join('\n');
const fields=['id','title','content','labels','ifBelievable','type','ifOpen','includeCondition','excludeCondition','timeliness','cycleTimeliness','orderStatus','lastUpdatedAt'];
const payload=c=>Object.fromEntries(fields.map(k=>[k,k==='content'?(c.content||[]).map(x=>({content:x.content})):c[k]]));
(async()=>{fs.mkdirSync(B,{recursive:true});const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});try{const p=ctx.pages()[0]||await ctx.newPage();await p.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base',{waitUntil:'domcontentloaded',timeout:30000});await p.waitForTimeout(2500);const req=(url,data)=>p.evaluate(async({url,data})=>{const r=await fetch(url,{method:data?'POST':'GET',credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok||j.code!==1)throw Error(`${url} ${r.status} ${j.msg||''}`);return j.data},{url,data});const call=(path,options={})=>p.evaluate(async({path,options})=>{const r=await fetch(path,{credentials:'include',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const j=await r.json();if(!r.ok||j.code!==1)throw Error(`${path} ${r.status} ${j.msg||''}`);return j.data},{path,options});
const card=await req('/api/kbe/v1/knowledge-card/detail?id='+CARD);fs.writeFileSync(B+'/card-before.json',JSON.stringify(card,null,2));const next={...card,title:'运费承担原则',content:[{content:RULE}],orderStatus:['PRE_SALE','AFTER_SALE']};await req('/api/kbe/v1/knowledge-card/update',payload(next));const after=await req('/api/kbe/v1/knowledge-card/detail?id='+CARD);if(after.title!=='运费承担原则'||body(after)!==RULE||JSON.stringify(after.orderStatus)!==JSON.stringify(next.orderStatus))throw Error('运费规则卡回读失败');fs.writeFileSync(B+'/card-after.json',JSON.stringify(after,null,2));
const agents=[];for(const id of AGENTS){const d=await call('/api/copilot/v1/agent/customized-agent/detail?id='+id);fs.writeFileSync(B+'/agent-'+id+'-before.json',JSON.stringify(d,null,2));const old=d.draftContent?.content||'';const content=old.includes('【业务原则：售前了解售后政策】')?old:old+'\n\n'+AGENT_RULE;const savePayload={id,content,desc:d.draftContent?.desc||d.name,labelGroupId:null,labelMeta:[],tableIds:[],toolType:[]};await call('/api/copilot/v1/agent/customized-agent/save-content',{method:'POST',body:JSON.stringify(savePayload)});const saved=await call('/api/copilot/v1/agent/customized-agent/detail?id='+id);if(saved.draftContent?.content!==content)throw Error('Agent草稿回读失败 '+id);await call('/api/copilot/v1/agent/customized-agent/publish',{method:'POST',body:JSON.stringify(savePayload)});const pub=await call('/api/copilot/v1/agent/customized-agent/detail?id='+id);if(pub.onlineContent?.content!==content)throw Error('Agent正式内容回读失败 '+id);fs.writeFileSync(B+'/agent-'+id+'-after.json',JSON.stringify(pub,null,2));agents.push({id,name:d.name,verified:true,publishTime:pub.publishTime})}
console.log(JSON.stringify({card:{id:CARD,verified:true,orderStatus:after.orderStatus},agents,backup:B},null,2));}finally{await ctx.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
