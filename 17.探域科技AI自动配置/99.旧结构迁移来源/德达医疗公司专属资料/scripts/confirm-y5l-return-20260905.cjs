// 本次明确拍板仅修正原商品知识；不修改拼多多商品开关、不新增/删除知识卡。
const fs=require('fs');
const {chromium}=require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const dir='D:/备份文件夹/探域问答审核-20260905';
const id='6a9a326284332a6367abf144',spu='724593187460';
const desired='是否支持7天无理由退货：是。\n本店Y5L支持7天无理由退货，医疗款拆封不作为直接拒绝退货的理由。具体订单及商品状态由人工核实，费用问题由人工确认。';
const fields=['id','title','content','labels','ifBelievable','type','ifOpen','includeCondition','excludeCondition','timeliness','cycleTimeliness','orderStatus'];
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const cond=v=>Object.fromEntries(Object.entries(v||{}).map(([k,x])=>[k,x===null?[]:x]));
(async()=>{const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});try{
 const page=ctx.pages()[0]||await ctx.newPage();await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base',{waitUntil:'domcontentloaded'});await page.waitForTimeout(3500);
 const req=(url,data)=>page.evaluate(async({url,data})=>{const r=await fetch(url,{method:data?'POST':'GET',credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok||j.code!==1)throw Error('请求失败 '+r.status+' '+j.code);return j.data;},{url,data});
 const before=await req('/api/kbe/v1/knowledge-card/detail?id='+id);
 const old=before.content.map(x=>x.content).join('\n');
 if(before.type!=='PRODUCT'||before.productCondition?.spuId!==spu||!before.ifOpen)throw Error('卡片类型/范围/启用状态保护未通过');
 if(old!==desired&&!/^是否支持7天无理由退货：\s*否\s*$/.test(old))throw Error('原文已由其他操作改变，停止覆盖：'+old);
 const file=dir+'/y5l-return-confirmation-'+Date.now()+'.json';
 const record={time:new Date().toISOString(),authorization:'用户确认Y5L统一支持7天无理由',before,desired,status:'prepared',platformProductSettingChanged:false};fs.writeFileSync(file,JSON.stringify(record,null,2));
 if(old!==desired){const payload=Object.fromEntries(fields.map(k=>[k,k==='content'?[{content:desired}]:before[k]]));await req('/api/kbe/v1/knowledge-card/update',payload);}
 const after=await req('/api/kbe/v1/knowledge-card/detail?id='+id);record.after=after;
 const unchanged=fields.filter(k=>!['content','excludeCondition'].includes(k)).every(k=>stable(before[k])===stable(after[k]))&&stable(cond(before.excludeCondition))===stable(cond(after.excludeCondition));
 if(after.content.map(x=>x.content).join('\n')!==desired||!unchanged)throw Error('保存后的内容或范围不一致，请查备份');
 const all=(await req('/api/kbe/v1/knowledge-card/page',{pageNo:1,pageSize:3000})).results;
 record.remainingY5lExplicitDenials=all.filter(c=>c.ifOpen&&c.productCondition?.spuId===spu&&/是否支持7天无理由退货[：:]\s*否/.test(c.content.map(x=>x.content).join('\n'))).map(c=>c.id);
 record.status='saved-and-readback-verified';record.learning=after.ifLearning;fs.writeFileSync(file,JSON.stringify(record,null,2));
 console.log(JSON.stringify({id,spu,status:record.status,remainingY5lExplicitDenials:record.remainingY5lExplicitDenials,learning:record.learning,backup:file,platformProductSettingChanged:false}));
}finally{await ctx.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
