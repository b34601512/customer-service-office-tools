const fs=require('fs');
const prefix='D:/备份文件夹/探域问答审核-20260905/q1-voice-20260906';
const cards=JSON.parse(fs.readFileSync(prefix+'-before.json','utf8'));
const rule='Q1这款是没有语音播报功能的，如果有语音播报需求，可以考虑Q1W型号哦。';
const sos='Q1有一键求救语音：待机或工作时按“一键求救”键，会持续播报“我需要帮助”，再次按该键停止。这与开机、调档时的常规语音播报不同。';
const changes={
 '6a9a3c554a45121da4d7ca50':s=>s+'\n'+sos,
 '6a9a3c384a45121da4d7c553':s=>s.replace('配有智能语音播报，遥控+定时功能','配有遥控+定时功能')+'\n'+rule+'\n'+sos,
 '6a9a3c39644e354d71a3f751':s=>s.replace('功能丰富（语音播报、遥控定时）','配有遥控定时功能')+'\n'+rule+'\n'+sos
};
const plan=Object.entries(changes).map(([id,f])=>{const c=cards.find(x=>x.id===id);if(!c?.ifOpen||c.includeCondition.shop.length!==1||c.includeCondition.shop[0].thirdShopId!=='2095398963959042048')throw Error('范围不符');const before=c.content.map(x=>x.content).join('\n');return{id,type:c.type,includeCondition:c.includeCondition,before,after:f(before)};});
fs.writeFileSync(prefix+'-plan.json',JSON.stringify(plan,null,2));console.log(JSON.stringify(plan.map(p=>({id:p.id,after:p.after})),null,2));
