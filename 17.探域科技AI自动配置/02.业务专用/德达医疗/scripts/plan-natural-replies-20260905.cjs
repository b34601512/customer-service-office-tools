// 仅买家答复措辞，不改变核实/审批流程，不假冒真人，不伪造操作完成。
const fs=require('fs');
const dir='D:/备份文件夹/探域问答审核-20260905';
const cards=JSON.parse(fs.readFileSync(dir+'/natural-replies-20260905-before.json','utf8'));
const replacements=[
 ['自动回复不代表已经登记或约定回电','登记及回电安排请以实际确认结果为准'],
 ['自动回复不能代替人工受理确认','是否受理请以实际确认结果为准'],
 ['自动回复不确认应付金额、免费范围、付款方式或已经退款','应付金额、免费范围、付款方式和退款进度需核实后确认'],
 ['不能仅凭自动回复表示已经处理','处理进度请以实际反馈为准'],
 ['自动回复不代表已经拒退、关闭售后或扣款','是否拒退、关闭售后或扣款请以实际处理记录为准'],
 ['不作自动承诺','以核实结果为准'],
 ['不自动承诺扣费、折旧费或费用全免','具体扣费、折旧费或减免费用需核实后确认'],
 ['申请人工客服确认','联系我们核实'],
 ['申请人工客服','联系我们'],
 ['申请人工售后核实','联系我们核实售后情况'],
 ['申请人工售后','联系我们处理售后'],
 ['申请人工检测','联系我们核实检测安排'],
 ['申请人工确认','联系我们确认'],
 ['申请人工处理','联系我们处理'],
 ['申请人工','联系我们'],
 ['联系人工售后','联系我们处理售后'],
 ['联系人工','联系我们'],
 ['由本店人工','由我们'],
 ['人工客服','我们'],
 ['人工','我们']
];
const plan=[];
for(const c of cards){
 if(!c.ifOpen)continue;const before=c.content.map(x=>x.content).join('\n');
 if(!before.includes('人工'))continue;
 const scope=c.includeCondition||{};const targets=[...(scope.shop||[]),...(scope.spu||[])];
 if(!targets.length||targets.some(x=>x.thirdShopId!=='2095398963959042048')||['rules','platform','productGroupId','sellerGroup'].some(k=>(scope[k]||[]).length))throw Error('非本店专属范围 '+c.id);
 const after=before.split('\n').map(line=>{
  if(/^Q\s*[:：]/.test(line))return line; // 保留买家关于人工的提问意图。
  for(const [from,to]of replacements)line=line.split(from).join(to);
  return line;
 }).join('\n');
 if(after!==before)plan.push({id:c.id,type:c.type,includeCondition:c.includeCondition,before,after});
}
fs.writeFileSync(dir+'/natural-replies-20260905-plan.json',JSON.stringify(plan,null,2));
const residual=plan.flatMap(p=>p.after.split('\n').filter(s=>!/^Q\s*[:：]/.test(s)&&/人工|申请我们|联系我们客服|我们我们/.test(s)).map(s=>({id:p.id,s})));
console.log(JSON.stringify({planned:plan.length,residual}));
if(residual.length)process.exitCode=1;
