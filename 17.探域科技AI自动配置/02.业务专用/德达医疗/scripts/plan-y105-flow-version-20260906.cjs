const fs=require('fs');
const prefix='D:/备份文件夹/探域问答审核-20260905/y105-flow-version-20260906';
const cards=JSON.parse(fs.readFileSync(prefix+'-before.json','utf8'));
const rule='Y105分新旧版本：新款最高流量800mL/min，旧款最高600mL/min。';
const edits={
 '6a9a3c39644e354d71a3f738':s=>s.replace('每分钟200ml-600ml流量可调（浓度≈96%），',rule+'请先核对机器版本，具体各档流量和氧浓度以对应版本说明书为准。'),
 '6a9a3c524a45121da4d7c9c8':s=>'Q:Y105每个档位流量浓度是多少？\nA:'+rule+'请提供机器铭牌及面板照片，我们先核对版本；各档流量、自动模式参数及氧浓度需按对应版本说明书核对，不能把新款参数套用于旧款。'
};
const plan=Object.entries(edits).map(([id,f])=>{const c=cards.find(x=>x.id===id);if(!c?.ifOpen||c.includeCondition.shop.length!==1||c.includeCondition.shop[0].thirdShopId!=='2095398963959042048')throw Error('范围不符');const before=c.content.map(x=>x.content).join('\n'),after=f(before);if(before===after)throw Error('原文不符');return{id,type:c.type,includeCondition:c.includeCondition,before,after};});
fs.writeFileSync(prefix+'-plan.json',JSON.stringify(plan,null,2));console.log(JSON.stringify(plan.map(p=>p.after)));
