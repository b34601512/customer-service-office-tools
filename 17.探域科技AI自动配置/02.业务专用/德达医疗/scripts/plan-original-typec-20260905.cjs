const fs=require('fs');
const prefix='D:/备份文件夹/探域问答审核-20260905/original-typec-20260905';
const cards=JSON.parse(fs.readFileSync(prefix+'-before.json','utf8'));
const rule='Y105、Y106均为Type-C充电接口，但只能使用对应机型的原装专用电源适配器，不能用普通手机充电器、充电宝或其他非原装电源替代。接口相同不代表兼容。';
const replacements={
 '6a9a3c394a45121da4d7c568':s=>s.replace('接口外形相同不代表手机充电器或充电宝一定兼容，',rule),
 '6a9a3c3b4a45121da4d7c5bb':s=>s+'\n'+rule,
 '6a9a3c39644e354d71a3f757':s=>s+'\n'+rule,
 '6a9a3c53644e354d71a3fbd0':s=>'Q:Y105 / Y106可以用充电宝充电器充吗？\nA:亲亲，这两款虽然都是Type-C接口，但只能使用对应机型的原装专用电源适配器，不能用普通手机充电器、充电宝或其他非原装电源替代。接口相同不代表兼容哦。原装适配器遗失或需要补配时，请发机器铭牌和订单信息，我们核对对应配件。',
 '6a9a3c394a45121da4d7c586':s=>s.replace('，充电口升级为「Type-C」','')+'\n'+rule,
 '6a9a3c394a45121da4d7c585':s=>s.replace('，Type-C充电口','')+'\n'+rule,
 '6a9a3c474a45121da4d7c7f4':s=>'Q:Y105 / Y106充电方法\nA:亲亲，'+rule+'请按对应版本说明书连接原装适配器充电；如不清楚连接位置，请发机器铭牌及接口照片，我们帮您核对。不要强行插接或拆装。',
 '6a9a3c474a45121da4d7c7f2':s=>s.replace('M模式与电池/充电需另核对版本，不凭本图推定所有版本自动调节规则。',rule+'M模式、电池配置及其他充电操作仍需核对具体版本，不凭本图推定。')
};
const plan=Object.entries(replacements).map(([id,fn])=>{const c=cards.find(c=>c.id===id);if(!c?.ifOpen)throw Error('缺少启用卡 '+id);const before=c.content.map(x=>x.content).join('\n');const after=fn(before);if(before===after)throw Error('未修改 '+id);return {id,type:c.type,includeCondition:c.includeCondition,before,after};});
fs.writeFileSync(prefix+'-plan.json',JSON.stringify(plan,null,2));
console.log(JSON.stringify(plan.map(x=>({id:x.id,after:x.after})),null,2));
