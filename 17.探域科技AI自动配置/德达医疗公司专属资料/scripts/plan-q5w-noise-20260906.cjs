const fs=require('fs');
const dir='D:/备份文件夹/探域问答审核-20260905';
const all=JSON.parse(fs.readFileSync(dir+'/q5w-noise-20260906-before.json','utf8'));
const changes={
 '6a9a30cfd9b5540ca9f5c59b':[['≈36.7dB（德达实验室实测）','约30分贝（参考值，实际声音受环境及工况影响）']],
 '6a9a3c394a45121da4d7c57d':[['降噪效果是四款中最出色的，运行时几乎听不到声音，仅32.7分贝，非常适合对静音要求高的用户～','具备降噪设计，运行噪声参考约30分贝，实际声音受环境及运行工况影响，不能保证不影响睡眠。']],
 '6a9a3c39644e354d71a3f74c':[['噪音30分贝超轻音，适合对噪音敏感用户。','噪音参考约30分贝，实际声音受环境及工况影响，对声音敏感可先咨询，不保证不影响睡眠。']]
};
const full={
 '6a9a3c44644e354d71a3f94d':'Q:Q5W分贝\nA:亲亲，Q5W制氧机运行噪声参考约30分贝。实际声音会受运行档位、测量距离和使用环境影响，静音不代表无声，也不能保证不影响睡眠。如果您对声音敏感，可以先告诉我们您的使用环境，帮您核对。',
 '6a9a3c44644e354d71a3f92d':'Q:Q5W噪音\nA:亲亲，Q5W运行噪声参考约30分贝，实际声音受工况、测量距离及使用环境影响。噪声感受因人而异，不能保证不影响睡眠；对声音敏感请先向我们确认适用情况。'
};
const plan=[...new Set([...Object.keys(changes),...Object.keys(full)])].map(id=>{const c=all.find(c=>c.id===id);if(!c||!c.ifOpen||!JSON.stringify(c.includeCondition).includes('2095398963959042048'))throw Error('状态或范围变化');const before=c.content.map(x=>x.content).join('\n');let after=full[id]||before;for(const [old,value]of changes[id]||[]){if(!after.includes(old))throw Error('正文变化');after=after.replace(old,value);}return {id,type:c.type,includeCondition:c.includeCondition,before,after};});
fs.writeFileSync(dir+'/q5w-noise-20260906-plan.json',JSON.stringify(plan,null,2));
