// 由本地完整快照/日志生成交接报告；不写远端。
const fs=require('fs');
const R='D:/桌面/办公软件/17.探域科技AI自动配置',B='D:/备份文件夹/探域问答审核-20260905';
const original=require(B+'/snapshot-1788589471551.json').cards.data.results;
const plan=require(B+'/planned-changes.json');
const journal=require(B+'/execution-journal.json');
const file=fs.readdirSync(B).filter(x=>/^(apply|verify)-after-\d+\.json$/.test(x)).sort((a,b)=>Number(a.match(/(\d+)\.json$/)[1])-Number(b.match(/(\d+)\.json$/)[1])).at(-1);
const after=require(B+'/'+file),beforeMap=new Map(original.map(c=>[c.id,c])),afterMap=new Map(after.map(c=>[c.id,c]));
const text=c=>(c.content||[]).map(x=>x.content).join('\n');
const fields=['id','title','labels','ifBelievable','type','ifOpen','includeCondition','excludeCondition','timeliness','cycleTimeliness','orderStatus','source','productCondition','ifOpenSync','ifHasUrl','urlInfos'];
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const normalize=c=>Object.fromEntries([...fields.map(k=>[k,k==='excludeCondition'&&c[k]?Object.fromEntries(Object.entries(c[k]).map(([n,v])=>[n,v===null?[]:v])):c[k]]),['body',text(c)]]);
const plannedIds=new Set(plan.map(x=>x.id));
const allChanged=original.filter(c=>afterMap.has(c.id)&&stable(normalize(c))!==stable(normalize(afterMap.get(c.id))));
const changed=allChanged.filter(c=>plannedIds.has(c.id));
const firstBeforeFile=fs.readdirSync(B).filter(x=>/^apply-before-\d+\.json$/.test(x)).sort().at(0);
const firstBeforeMap=new Map(require(B+'/'+firstBeforeFile).map(c=>[c.id,c]));
const externalChanges=allChanged.filter(c=>!plannedIds.has(c.id)).map(c=>({id:c.id,alreadyPresentBeforeFirstWrite:stable(normalize(firstBeforeMap.get(c.id)))===stable(normalize(afterMap.get(c.id))),original:{ifOpen:c.ifOpen,ifBelievable:c.ifBelievable},current:{ifOpen:afterMap.get(c.id).ifOpen,ifBelievable:afterMap.get(c.id).ifBelievable}}));
const unexpected=externalChanges.filter(c=>!c.alreadyPresentBeforeFirstWrite).map(c=>c.id);
const missing=original.filter(c=>!afterMap.has(c.id)).map(c=>c.id);
const added=after.filter(c=>!beforeMap.has(c.id));
const disabled=changed.filter(c=>c.ifOpen&&!afterMap.get(c.id).ifOpen);
const counts=a=>a.reduce((o,c)=>(o[c.type]=(o[c.type]||0)+1,o),{});
const verified=plan.filter(x=>stable(normalize(x.after))===stable(normalize(afterMap.get(x.id)))).length;
const audit={time:new Date().toISOString(),finalSnapshot:file,originalCount:original.length,finalCount:after.length,originalTypes:counts(original),finalTypes:counts(after),changed:changed.length,bodyChanged:changed.filter(c=>text(c)!==text(afterMap.get(c.id))).length,disabled:disabled.length,changedTypes:counts(changed),planned:plan.length,matched:verified,stageChanges:changed.filter(c=>stable(c.orderStatus)!==stable(afterMap.get(c.id).orderStatus)).map(c=>({id:c.id,before:c.orderStatus,after:afterMap.get(c.id).orderStatus})),unexpected,externalChanges,missing,added:added.map(c=>({id:c.id,type:c.type,ifOpen:c.ifOpen,content:text(c)})),learning:after.filter(c=>plannedIds.has(c.id)&&c.ifLearning).map(c=>c.id),networkWrites:journal.entries.filter(e=>e.status==='applied').length};
fs.writeFileSync(B+'/final-audit.json',JSON.stringify(audit,null,2));
const simulations=[];
for(const fn of ['simulation-results.json','simulation-retest-results.json','simulation-final-safety.json','simulation-final-keywords.json']){
 if(!fs.existsSync(B+'/'+fn))continue;
 for(const t of JSON.parse(fs.readFileSync(B+'/'+fn,'utf8'))){
  let final=t.final;
  if(!final)for(const r of t.api||[])if(r.url.endsWith('/get-card')){try{const d=JSON.parse(r.body).data;if(d?.status==='COMPLETED'&&JSON.parse(d.payload).originQuestion===t.q)final=d;}catch{}}
  const p=final?JSON.parse(final.payload):null;
  simulations.push({key:t.key,q:t.q,stage:t.stage,completed:!!final,ifSend:final?.ifSend,reply:p?.trickList?.flatMap(x=>x.content||[]).join('\n')||'(未完成或未返回有效正文)',references:p?.extBody?.reference||[],external:p?.extBody?.isExternalInfo,file:fn});
 }
}
fs.writeFileSync(B+'/simulation-summary.json',JSON.stringify(simulations,null,2));
fs.writeFileSync(R+'/模拟问答记录-20260905.md','# 模拟问答记录\n\n均在Agent Builder正式模式的模拟买家窗口进行；不是向真实买家发消息。已完成记录ifSend=false。未选SKU，包含未下单与交易成功阶段；模拟界面会保留测试历史，不等同彼此隔离的全新买家会话。不能把这些样本当作全量场景保证。\n\n'+simulations.map(t=>`## ${t.key}\n\n- 问题：${t.q}\n- 阶段：${t.stage}\n- 完成：${t.completed}；实际发送标志：${t.ifSend}\n- 引用：${JSON.stringify(t.references)}；外部信息标志：${t.external}\n\n${t.reply}\n`).join('\n'));
const report=`# 问答审核报告 · 2026-09-05

> 已实际优化${audit.changed}张原卡，${audit.disabled}张停用、没有删除；15项业务事实待你拍板。不要把这次修改理解为所有商品参数和证照已核实。

## 已完成

- 完整阅读背景及最初${original.length}张知识正文：全店1049、商品951、聊天9。保留完整原文、来源、ID和范围。没有声称逐一核验所有源图片、厂家检测报告或真实买家会话。
- ${audit.bodyChanged}张改正文；停用${audit.disabled}张与改正文有重叠（15张重复卡、8张内部/过期/生成失败记录）。不新建替代卡、不删除卡、不转换类型。
- 医疗：移除“血氧区间→档位”“婴儿固定流量”“慢阻肺先开最大”等自动处方；不再用升级购机替代就医或检测。
- 售后：不虚构已登记、已退款、已加急、检测正常；不诱导买家把质量问题改成无理由；去掉自动报废、无证据归责和维修即全新的说法。
- 政策：沿用已拍板7天无理由（医疗拆封也可）、30天换款、无备用机和价格/费用人工核实；不要求你重拍这些已有决定。
- 内容：修正A1/A1L串答、便携档位当升数、W/Wh/VA混淆、缺失型号上下文、绝对防火/不影响睡眠等保证；保留能够确认的具体功能与参数，没有把所有知识都改成同一句转人工。
- 恢复性：先做一张错字卡写入→恢复往返核验，再批量应用；每次实际写入记录当时原文和结果，遇到第三方修改会跳过，恢复也有冲突保护。

## 最终数据核验

| 项目 | 结果 |
|---|---|
| 计划卡目标匹配 | ${verified}/${plan.length}；其中1张原本就一致，无需实际写入 |
| 实际变更类型 | SHOP ${audit.changedTypes.SHOP||0} / PRODUCT ${audit.changedTypes.PRODUCT||0} / CHAT ${audit.changedTypes.CHAT||0} |
| 店铺/SKU范围、类型 | 保留 |
| 订单阶段 | 仅3张安全/借机政策由售后扩展为三阶段；其余不变 |
| 本次写入期间未计划的现有卡变化 / 丢失 | ${unexpected.length} / ${missing.length} |
| 待学习的计划卡 | ${audit.learning.length} |
| 当前总数 | ${after.length}：${JSON.stringify(audit.finalTypes)} |

作业期间后台另生成1张默认停用的聊天知识，内容是“是否有十升规格”；本次没有调用新增卡接口，已读并保留未改，因此总数从2009变2010。另有1张“赠送42L氧气袋”聊天卡，在本次首次写入之前已由停用/不可信变为启用/可信（14:59:53），不是本次变更，未覆盖；不推定是谁操作。23张卡的“空排除条件”被服务端从null规范化为[]，仍没有任何排除项；原始序列化也留在备份中，不把这种格式变化当作丢失条件。

## 模拟结果与限制

- 正式模拟已验证：不按慢阻肺血氧88%自动给档；保价要求人工；A1无雾化无遥控且补测不再扩写L/W规则；质量退货不改不实原因；不假称已退款。
- 首轮发现安全/备用机卡仅限售后，已定向扩展3张阶段；A1生成扩写另收紧1张。后续安全问法仍出现“未找到”和未引用知识的通用答复，又仅将2张安全问题明确改成买家实际会说的“打火机/明火”问法。
- 备用机后续回答已为不提供借用。最后两道“打火机/明火”问题分别在未下单、交易成功状态明确禁止，并真实引用更新后的813卡（isExternalInfo=0）；不再依靠无引用的通用答复。详见[模拟记录](./模拟问答记录-20260905.md)。这些样本通过，不代表全部措辞、全部SKU和所有场景都已覆盖。
- 未对真实买家发送、接管或转交消息；没有改接待、续费、全局学习或全局售前售后映射。测试包含同一模拟历史，未选择具体SKU，故商品来源冲突仍须处理。
- 验证是否导致生产返工：是，2批定向补改；范围分别4张、2张，没有因此反复整库改写。

## 你优先拍板这6项

1. [流量—浓度与SKU能力](./待拍板-20260905/01-流量浓度与SKU额定能力.md)：9L与96%是否同工况？需要各版本额定参数表。
2. [便携版本](./待拍板-20260905/02-便携版本充电电池及M键.md)：电池、充电器、边充边用、M键、600/800mL等。
3. [功能表](./待拍板-20260905/03-语音遥控雾化功能串型号.md)：Q1、2AW、Y5AW语音，以及A1/C1系列新旧版本。
4. [证照](./待拍板-20260905/04-医疗注册证和宣传证件.md)：保健/医用混写、2026到期与2031延续注册、CE/FDA范围。
5. [商品退货开关](./待拍板-20260905/05-商品退货开关与已拍板政策冲突.md)：现有一个商品参数仍写7天无理由“否”，是否同步改商品端。
6. [源资料与重新学习](./待拍板-20260905/06-商品自动学习回流机制.md)：先统一商品源文再重学，谁维护SKU真源。

其他赠品、保修例外、发票、物流、教程、材质、噪声/功率/海拔和营销证据，均已按问题分开记录原卡ID与原文，见[15项拍板索引](./待拍板-20260905/拍板索引.md)。不确定的事实未擅自取一个数值覆盖其他版本。

## 源数据根因：已核实到哪一步

商品详情、参数和聊天学习是人工QA之外的知识来源，旧价格与政策会在再次学习时重新进入。当前商品学习配置明确为自动触发关闭（ifAutoTrigger=false、triggerPointList=[]），27件商品已学习；不能仅因卡片ifOpenSync=true就断言当前自动重学已开启。此次未改这个开关，建议先修原始详情/参数再重新学习。

## 判断依据

- 店铺政策：原AI工作手册及2026-09-04拍板记录；现场事实：本次完整后台快照与模拟引用ID，不以历史错误的平台/数量说明覆盖现场。
- 血氧读数不能单独诊断或决定治疗，需结合症状及测量局限；因此撤除单次读数直接调档的规则。[FDA血氧仪使用资料](https://www.fda.gov/consumers/consumer-updates/pulse-oximeter-basics)
- 居家用氧需医疗专业人员评估与处方，氧气使用有火灾风险；据此保留就医与禁明火提示，不新增剂量建议。[NHS居家氧疗](https://www.nhs.uk/tests-and-treatments/home-oxygen-treatment/)
- 呼吸机补氧兼容性依具体设备和附件，不能统一写“至少5L”或任意三通联用。[ResMed补氧兼容说明](https://ap.resmed.com/knowledge/can-i-use)
- 产品数值、法律责任、认证和平台业务权限，不能仅靠通用资料确定，已分别留作核实；此报告不是对产品疗效、证照或法律结论的鉴定。

## 交接与恢复

- [逐卡前后对照](./问答优化逐条清单-20260905.md)、[模拟记录](./模拟问答记录-20260905.md)、[主问题笔记](./issue-问答全面优化-20260905.md)、[跨阶段问题笔记](./issue-安全知识跨阶段召回-20260905.md)。
- 完整备份目录：\`D:/备份文件夹/探域问答审核-20260905\`。关键文件：初始snapshot-1788589471551.json、每批apply-before/after、planned-changes.json、execution-journal.json、final-audit.json。
- 恢复入口为\`scripts/apply-optimization-20260905.cjs restore\`。由后续AI先读日志确认目标，再执行；按实际写入历史倒序恢复，遇到不等于本次改后内容的卡会跳过，避免覆盖后来的人工作业。不要用旧导入/删除脚本“恢复”。
- 只读复核入口为\`scripts/apply-optimization-20260905.cjs verify\`。不要在未读计划与日志时重跑apply或生成新副本。
`;
fs.writeFileSync(R+'/问答审核报告-20260905.md',report);
console.log(JSON.stringify(audit,null,2));
if(unexpected.length||missing.length||verified!==plan.length||audit.learning.length)process.exitCode=1;
