const fs=require('fs');
const dir='D:/备份文件夹/探域问答审核-20260905';
const all=JSON.parse(fs.readFileSync(dir+'/portable-start-20260906-before.json','utf8'));
const texts={
 '6a9a3c524a45121da4d7c9e1':'Q:便携制氧机为什么刚开机不出气？\nA:亲亲，便携制氧机开机就开始制氧，初期需要先积蓄一些氧气，建议开机约2分钟、机器正常供氧后再开始吸氧。如果等待后仍不出气，或出现报警，请把机器型号、屏幕提示及操作视频发给我们核对，不要一直当作正常启动等待。',
 '6a9a3c524a45121da4d7c9e6':'Q:便携制氧机开机后能马上吸吗？\nA:亲亲，便携制氧机开机就开始制氧，但初期需要先积蓄一些氧气，建议开机约2分钟、机器正常供氧后再开始吸氧。15分钟只是较保守的等待建议，并非必须等待的时间；具体型号如有特别要求，以对应说明书为准。'
};
const plan=Object.entries(texts).map(([id,after])=>{const c=all.find(x=>x.id===id);if(!c||!c.ifOpen||c.type!=='SHOP'||c.includeCondition.shop.length!==1||c.includeCondition.shop[0].thirdShopId!=='2095398963959042048')throw Error('范围不符');return {id,type:c.type,includeCondition:c.includeCondition,before:c.content.map(x=>x.content).join('\n'),after};});
fs.writeFileSync(dir+'/portable-start-20260906-plan.json',JSON.stringify(plan,null,2));
console.log('planned '+plan.length);
