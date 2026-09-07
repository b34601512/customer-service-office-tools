const fs=require('fs');
const dir='D:/备份文件夹/探域问答审核-20260905';
const all=JSON.parse(fs.readFileSync(dir+'/q5w-weight-20260906-before.json','utf8'));
const replacements={
 '6a9a3c54644e354d71a3fc10':[['重量约25.9kg','主机净重约25.9kg']],
 '6a9a30cfd9b5540ca9f5c59f':[['净含量：22.6kg','主机净重：约25.9kg'],['毛重：25.6kg','包装毛重：需核对对应包装的实测重量']],
 '6a9a30cfd9b5540ca9f5c59b':[['22.6kg','约25.9kg']],
 '6a9a30cfd9b5540ca9f5c599':[['本制氧机重量为22.6KG，采用轻便设计，让吸氧不负重。','Q5W制氧机主机净重约25.9kg。']]
};
const plan=Object.entries(replacements).map(([id,pairs])=>{const c=all.find(c=>c.id===id);if(!c||!c.ifOpen)throw Error('卡片状态变化');const before=c.content.map(x=>x.content).join('\n');let after=before;for(const [old,value]of pairs){if(!after.includes(old))throw Error('正文变化 '+id);after=after.replace(old,value);}if(!JSON.stringify(c.includeCondition).includes('2095398963959042048'))throw Error('店铺不符');return {id,type:c.type,includeCondition:c.includeCondition,before,after};});
fs.writeFileSync(dir+'/q5w-weight-20260906-plan.json',JSON.stringify(plan,null,2));
console.log('planned '+plan.length);
