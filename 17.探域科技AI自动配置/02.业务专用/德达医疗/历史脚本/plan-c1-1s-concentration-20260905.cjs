const fs=require('fs');const dir='D:/备份文件夹/探域问答审核-20260905';
const a=JSON.parse(fs.readFileSync(dir+'/c1-1s-concentration-20260905-before.json','utf8'));
const p=[];const put=(c,after)=>p.push({id:c.id,type:c.type,includeCondition:c.includeCondition,before:c.content.map(x=>x.content).join('\n'),after});
const rule='C1系列（含C1L）仅1L/min时为96%高浓度工况，调大流量档位后氧浓度会下降；9L只代表气流大小，不代表9L/min时仍有96%氧浓度，其他档位不保证该高浓度。';
const spu=new Set(['446872879403','582414503778','686392427262','584301262287','446929841571']);
for(const c of a){const b=c.content.map(x=>x.content).join('\n');if(!c.ifOpen||c.type!=='PRODUCT'||!c.includeCondition.spu.some(s=>spu.has(s.spuId))||!(/96\s*%/.test(b)||c.id==='6a9a32535680f7693636d3e0')||/^!\[/.test(b)||/专利及知识产权/.test(b))continue;
 let after=b.replace(/96%/g,'96%（仅1L/min工况）').replace(/（仅1L\/min工况）（1L\/min）/g,'（仅1L/min工况）').replace(/氧浓度90%以上是正常值范围/g,'氧浓度是否正常需结合当前流量档位与该版本说明书核对，不把90%以上套用所有档位');
 if(c.id==='6a9a32535680f7693636d3e0')after=after.replace('氧浓度：90%氧浓度','氧浓度：1L/min时可达96%，调大档位后下降');
 after+='\n\n'+rule;put(c,after);
}
for(const [id,series] of [['6a9a3c494a45121da4d7c848','C1系列（含C1L）'],['6a9a3c49644e354d71a3fa30','1S系列（如1SW）']]){const c=a.find(c=>c.id===id);put(c,'Q:'+c.content[0].content.split('\n')[0].replace(/^Q:/,'')+'\nA:'+series+'只有1L/min时为96%高浓度工况，调大流量档位后氧浓度会下降。9L只代表气流大小，不代表9L/min时仍有96%氧浓度，其他档位不保证该高浓度。请按医生明确的用氧要求选机和设置，不把最大可调流量当作高浓度额定供氧能力。');}
for(const id of ['6a9a3c384a45121da4d7c552','6a9a3c384a45121da4d7c54f','6a9a3c384a45121da4d7c54e']){const c=a.find(c=>c.id===id),b=c.content.map(x=>x.content).join('\n');let after=b.replace('支持1-9升流量调节（浓度约30%-96%），其中1升≥96%为高浓度制氧','支持流量调节，仅1L/min时为96%高浓度工况，调大档位后浓度下降，9L仅代表气流大小，不保证96%高浓度').replace(/高浓度制氧（1升≈96%）/g,'高浓度制氧（仅1L/min时96%，调大档位后浓度下降，9L仅代表气流大小、不保证该高浓度）');put(c,after);}
const c=a.find(c=>c.id==='6a9a3c394a45121da4d7c577');put(c,'Q:1SW和2SW区别是什么？\nA:1SW属于1S系列，仅1L/min时为96%高浓度工况，调大流量档位后浓度下降，9L仅代表气流大小，不保证该高浓度。2SW的额定制氧能力现有资料按2L/min介绍，其各档浓度需核对对应版本流量—浓度表，不能把1SW规则直接套用到2SW。请按医生明确的用氧要求选机，不只比较最大可调档位。');
// Card disappeared independently during execution: do not recreate or overwrite external work.
const final=p.filter(x=>x.id!=='6a9a3239d9b5540ca9f5ccb9');
fs.writeFileSync(dir+'/c1-1s-concentration-20260905-plan.json',JSON.stringify(final,null,2));console.log(JSON.stringify({total:final.length,shop:final.filter(x=>x.type==='SHOP').length,product:final.filter(x=>x.type==='PRODUCT').length}));
