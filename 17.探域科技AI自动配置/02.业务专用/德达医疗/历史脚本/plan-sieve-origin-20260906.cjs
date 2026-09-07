const fs=require('fs');
const dir='D:/备份文件夹/探域问答审核-20260905';
const all=JSON.parse(fs.readFileSync(dir+'/sieve-origin-20260906-before.json','utf8'));
const body=c=>c.content.map(x=>x.content).join('\n');
const home=new Set(['446872879403','582414503778','686392427262','584301262287','446929841571','667516125303','495073449417','465054918765']);
const mixed=new Set(['484073373343','757794482143','724593187460','681658998329','651142151222','536558120877','475856967125','453544922976']);
const rule='本店医用款使用进口分子筛，其他款使用非进口分子筛。';
const models='医用款包括Q3L、Y300W、Q5L、Q5S、Q5W、Y5AW、Q10L、Y5L、Y5W。';
const custom={
 '6a9a3c544a45121da4d7ca38':'Q:分子筛是什么品牌？\nA:亲亲，'+rule+models+'请告知具体型号，分子筛品牌需核对该型号的厂家资料后回复。',
 '6a9a3c544a45121da4d7ca32':'Q:分子筛是什么材质？\nA:亲亲，'+rule+'请告知具体型号，分子筛材料类型需核对该型号的厂家资料，不能仅凭是否进口判断材质。',
 '6a9a3c57644e354d71a3fc96':'Q:你们这和别家便宜的有啥区别？\nA:亲亲，不同型号的流量、对应氧浓度、功能和配置有区别。'+rule+'您可以把正在比较的型号或商品链接发给我们，我们帮您逐项核对，避免把不同类型的机器直接比较。',
 '6a9a3c3d4a45121da4d7c619':'Q:核心部件有进口批文吗？\nA:亲亲，'+rule+'分子筛是否进口与整机证照是不同事项。请提供具体型号，您需要的部件来源资料及整机证照，我们核对该型号资料后回复。',
 '6a9a3c3d4a45121da4d7c618':'Q:有进口批文吗？\nA:亲亲，'+rule+'进口分子筛不代表整机进口。请告知具体型号和需要查看的证照，我们核对该型号资料后回复。'
};
const origin=/(?:法国)?(?:原装)?(?:高端)?进口(?:CECA)?(双核)?分子筛/g;
const fixHome=s=>s.replace(/法国CECA进口分子筛/g,'非进口分子筛').replace(origin,(_,dual)=>(dual||'')+'非进口分子筛').replace(/原装进口([， ]+氧气浓度)/g,'$1');
const plan=[];
for(const c of all){
 if(!c.ifOpen)continue;
 const before=body(c); let after=custom[c.id];
 if(after===undefined && c.type==='PRODUCT' && /分子筛/.test(before) && /进口|国产/.test(before)){
  const scopes=c.includeCondition.spu||[];
  if(scopes.length!==1||scopes[0].thirdShopId!=='2095398963959042048')throw Error('未知范围 '+c.id);
  const s=scopes[0];
  if(home.has(s.spuId))after=fixHome(before);
  else if(c.id==='6a9a5a2ab952375ec0323035')after=before.split('\n').map(line=>/型号：.*(?:Q2L|Q1W)/.test(line)?fixHome(line):line).join('\n');
  else if(['6a9a5a0fb952375ec0322ee5','6a9a5a0fb952375ec0322ee2'].includes(c.id))after=fixHome(before);
  else if(mixed.has(s.spuId)&&s.skuIds.length===0){
   // This SPU contains both medical and nonmedical SKUs: qualify origin inline.
   after=before.replace(/(?:法国CECA进口|法国原装|法国高端进口|原装进口|进口)分子筛/g,'分子筛（医用款为进口，其他款为非进口）');
   if(c.id==='6a9a31a1d9b5540ca9f5ca74')after=after.replace(/- \*\*价格对比\*\*：价格贵，约为国产的2倍\n/,'');
  }
 }
 if(after!==undefined&&after!==before)plan.push({id:c.id,type:c.type,includeCondition:c.includeCondition,before,after});
}
if(!plan.length)throw Error('空计划');
fs.writeFileSync(dir+'/sieve-origin-20260906-plan.json',JSON.stringify(plan,null,2));
console.log(JSON.stringify({count:plan.length,ids:plan.map(x=>x.id)}));
