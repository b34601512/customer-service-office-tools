const fs = require('fs');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const BACKUP = 'D:/备份文件夹/探域问答审核-20260907-c1l-split';
const SPU = '446872879403';
const SHOP = '2095398963959042048';
const C1L = ['1952124006359', '1952125240620', '1952125240621'];
const MIXED = {
  '6a9a99ec5680f76936395523': {
    remove: '、雾化（仅C1L款）',
    title: 'C1L专属：雾化功能',
    add: 'C1L款支持雾化功能；C1款不含雾化功能。'
  },
  '6a9a99ec5680f76936395521': {
    remove: '、雾化（仅C1L款）',
    title: 'C1L专属：雾化功能（德达制氧机）',
    add: 'C1L款支持雾化功能；C1款不含雾化功能。'
  },
  '6a9a32665680f7693636d495': {
    remove: '、雾化（仅C1L款）',
    title: 'C1L专属：雾化功能（中德合资款）',
    add: 'C1L款支持雾化功能；C1款不含雾化功能。'
  },
  '6a9a32665680f7693636d477': {
    remove: '（机器设有雾化口（仅C1L款））',
    title: 'C1L专属：雾化口与雾化功能',
    add: 'C1L款设有雾化口并支持雾化功能；C1款不含雾化功能。'
  },
  '6a9a32665680f7693636d4a5': {
    remove: '+雾化功能（仅C1L款）+10级过滤+远程遥控（仅C1L款）',
    title: 'C1L专属：雾化与远程遥控',
    add: 'C1L款支持雾化功能和远程遥控；C1款不含这两项专属功能。'
  },
  '6a9a32665680f7693636d445': {
    remove: '**雾化功能（仅C1L款）**：院线升级款无，院线雾化款有\n',
    title: 'C1L专属：院线雾化款',
    add: '院线雾化款对应C1L，支持雾化功能；院线升级款对应C1，不支持雾化。'
  },
  '6a9a32665680f7693636d481': {
    remove: '- **雾化速率**：≥0.2mL/min，雾化功能仅限C1L雾化款\n',
    title: 'C1L专属：雾化参数',
    add: 'C1L雾化款支持雾化，雾化速率≥0.2mL/min；C1款不含雾化功能。'
  }
};
const SCOPE_ONLY = '6a9a32665680f7693636d45d';
const body = c => (c.content || []).map(x => x.content).join('\n');
const fields = ['id','title','content','labels','ifBelievable','type','ifOpen','includeCondition','excludeCondition','timeliness','cycleTimeliness','orderStatus','lastUpdatedAt'];
const payload = c => Object.fromEntries(fields.map(k => [k, k === 'content' ? (c.content || []).map(x => ({content:x.content})) : c[k]]));
const scoped = condition => ({...condition, spu:[{thirdShopId:SHOP,spuId:SPU,skuIds:C1L}]});

(async()=>{
  fs.mkdirSync(BACKUP,{recursive:true});
  const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});
  try{
    const page=ctx.pages()[0]||await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(3000);
    const req=(url,data)=>page.evaluate(async({url,data})=>{const r=await fetch(url,{method:data?'POST':'GET',credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok||j.code!==1)throw Error(`${url} ${r.status} ${j.msg||''}`);return j.data},{url,data});
    const all=(await req('/api/kbe/v1/knowledge-card/page',{pageNo:1,pageSize:3000})).results;
    fs.writeFileSync(`${BACKUP}/all-before.json`,JSON.stringify(all,null,2));
    const detail=id=>req(`/api/kbe/v1/knowledge-card/detail?id=${encodeURIComponent(id)}`);
    const write=c=>req('/api/kbe/v1/knowledge-card/update',payload(c));
    const journal={startedAt:new Date().toISOString(),updates:[],created:[]};
    const existingTitles=new Set(all.filter(c=>c.ifOpen).map(c=>c.title));
    for(const [id,rule] of Object.entries(MIXED)){
      const before=await detail(id), old=body(before);
      const after=old.includes(rule.remove)
        ? old.replace(rule.remove,'').replace(/\n\n\n+/g,'\n\n').trim()
        : (id === '6a9a32665680f7693636d481'
          ? old.replace(/- \*\*雾化速率\*\*：≥0\.2mL\/min，雾化功能仅限C1L雾化款\s*/,'').replace(/\n\n\n+/g,'\n\n').trim()
          : old);
      if(after!==old){
        await write({...before,content:[{content:after}]});
        const saved=await detail(id);
        if(body(saved)!==after) throw Error(`原卡回读失败 ${id}`);
        journal.updates.push({id,title:before.title,removed:rule.remove,before:old,after});
      } else journal.updates.push({id,title:before.title,status:'already-split'});
      if(existingTitles.has(rule.title)){journal.created.push({title:rule.title,status:'already-exists'});continue;}
      const created=await req('/api/kbe/v1/knowledge-card/save',{title:rule.title,content:[{content:rule.add}],labels:['商品详情'],ifBelievable:false,knowledgeType:'PRODUCT',ifOpen:true,includeCondition:{spu:[{thirdShopId:SHOP,spuId:SPU,skuIds:C1L}],shop:[],rules:[],productGroupId:[],sellerGroup:[],platform:[]},excludeCondition:{spu:[],shop:[],rules:[],productGroupId:[],sellerGroup:[],platform:[]},orderStatus:[]});
      journal.created.push({title:rule.title,status:'created',response:created});
      existingTitles.add(rule.title);
    }
    const beforeScope=await detail(SCOPE_ONLY);
    const oldScope=JSON.stringify(beforeScope.includeCondition);
    await write({...beforeScope,includeCondition:scoped(beforeScope.includeCondition)});
    const savedScope=await detail(SCOPE_ONLY);
    if(JSON.stringify(savedScope.includeCondition)!==JSON.stringify(scoped(beforeScope.includeCondition))) throw Error('C1L范围回读失败');
    journal.scopeOnly={id:SCOPE_ONLY,before:oldScope,after:savedScope.includeCondition};
    fs.writeFileSync(`${BACKUP}/execution-journal.json`,JSON.stringify(journal,null,2));
    console.log(JSON.stringify({updated:journal.updates.length,created:journal.created.filter(x=>x.status==='created').length,scopeOnly:SCOPE_ONLY,backup:BACKUP},null,2));
  }finally{await ctx.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
