const fs=require('fs');
const prefix='D:/备份文件夹/探域问答审核-20260905/charge-use-20260905';
const cards=JSON.parse(fs.readFileSync(prefix+'-before.json','utf8'));
const rule='Y105、Y106连接对应机型的原装专用Type-C电源适配器时，可以边充电边吸氧。';
const changes={
 '6a9a3c474a45121da4d7c7f4':s=>s.replace('接口相同不代表兼容。','接口相同不代表兼容。'+rule),
 '6a9a3c474a45121da4d7c7f2':s=>s.replace('接口相同不代表兼容。','接口相同不代表兼容。'+rule),
 '6a9a3c394a45121da4d7c568':s=>s.replace('能否边充边用须按该版本说明书确认。',rule),
 '6a9a3c3b4a45121da4d7c5bb':s=>s+'\n'+rule+'其他型号请按对应说明书核对。',
 '6a9a3c52644e354d71a3fbc5':s=>'Q:充电器发烫怎么回事？\nA:亲亲，请先提供机器型号、适配器标签照片，以及发热情况，我们帮您核对。'+rule+'但不能仅凭可以边充边用就认定发烫正常；如出现异常烫手、焦味、冒烟或外壳变形，请停止使用该适配器并联系我们。其他型号能否边充边用需按对应说明书核对，不能统一套用。'
};
const plan=Object.entries(changes).map(([id,f])=>{const c=cards.find(c=>c.id===id);if(!c?.ifOpen)throw Error('卡不存在或未启用');const before=c.content.map(x=>x.content).join('\n'),after=f(before);if(before===after)throw Error('未修改');return{id,type:c.type,includeCondition:c.includeCondition,before,after};});
fs.writeFileSync(prefix+'-plan.json',JSON.stringify(plan,null,2));console.log(JSON.stringify(plan.map(p=>({id:p.id,after:p.after})),null,2));
