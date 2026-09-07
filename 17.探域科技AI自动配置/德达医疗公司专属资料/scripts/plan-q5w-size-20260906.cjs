const fs=require('fs');
const dir='D:/备份文件夹/探域问答审核-20260905';
const all=JSON.parse(fs.readFileSync(dir+'/q5w-size-20260906-before.json','utf8'));
const c=all.find(c=>c.id==='6a9a30cfd9b5540ca9f5c59f');
const before=c.content.map(x=>x.content).join('\n');
if(!c.ifOpen||c.type!=='PRODUCT'||c.includeCondition.spu.length!==1||c.includeCondition.spu[0].spuId!=='557370224809'||c.includeCondition.spu[0].thirdShopId!=='2095398963959042048'||!before.includes('规格尺寸：310×370×470mm'))throw Error('范围或正文变化');
fs.writeFileSync(dir+'/q5w-size-20260906-plan.json',JSON.stringify([{id:c.id,type:c.type,includeCondition:c.includeCondition,before,after:before.replace('规格尺寸：310×370×470mm','主机尺寸：442×306×622mm')}],null,2));
