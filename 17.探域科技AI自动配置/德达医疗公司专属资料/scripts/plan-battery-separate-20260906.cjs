const fs=require('fs');const dir='D:/备份文件夹/探域问答审核-20260905';
const all=JSON.parse(fs.readFileSync(dir+'/battery-separate-20260906-before.json','utf8'));
const ids=['6a9a3c534a45121da4d7c9ed','6a9a3c474a45121da4d7c7f4'];
const sentence='Y105、Y106均支持将电池取下单独充电，必须使用对应机型的原装专用电源适配器。';
const plan=ids.map(id=>{const c=all.find(c=>c.id===id);if(!c.ifOpen||c.type!=='SHOP'||c.includeCondition.shop.length!==1||c.includeCondition.shop[0].thirdShopId!=='2095398963959042048')throw Error('范围不符');const before=c.content.map(x=>x.content).join('\n');const after=id===ids[0]?'Q:Y105、Y106可以取下电池单独充电吗？\nA:亲亲，'+sentence+'不能使用普通手机充电器、充电宝或其他非原装电源替代；接口相同不代表兼容。取装电池和连接位置请按对应型号说明书操作，不要强行插接或拆装。':before.replace('请按对应版本说明书连接原装适配器充电；',sentence+'请按对应版本说明书连接原装适配器充电；');if(after===before)throw Error('未改');return {id,type:c.type,includeCondition:c.includeCondition,before,after};});
fs.writeFileSync(dir+'/battery-separate-20260906-plan.json',JSON.stringify(plan,null,2));
