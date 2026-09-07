const fs=require('fs');
const dir='D:/备份文件夹/探域问答审核-20260905';
const all=JSON.parse(fs.readFileSync(dir+'/sieve-scope-20260906-before.json','utf8'));
const ids=['6a9a3c57644e354d71a3fc96','6a9a3c544a45121da4d7ca32','6a9a3c3d4a45121da4d7c619','6a9a3c3d4a45121da4d7c618','6a9a3c544a45121da4d7ca38'];
const old='本店医用款使用进口分子筛，其他款使用非进口分子筛。';
const replacement='除独立的弥散制氧机产品线外，本店医用款使用进口分子筛，其他款使用非进口分子筛；弥散款需单独按具体型号核对。';
const plan=ids.map(id=>{const c=all.find(c=>c.id===id);const before=c.content.map(x=>x.content).join('\n');if(!c.ifOpen||c.type!=='SHOP'||!before.includes(old)||c.includeCondition.shop.length!==1||c.includeCondition.shop[0].thirdShopId!=='2095398963959042048')throw Error('范围或正文变化 '+id);return {id,type:c.type,includeCondition:c.includeCondition,before,after:before.replace(old,replacement)};});
fs.writeFileSync(dir+'/sieve-scope-20260906-plan.json',JSON.stringify(plan,null,2));
console.log('planned '+plan.length);
