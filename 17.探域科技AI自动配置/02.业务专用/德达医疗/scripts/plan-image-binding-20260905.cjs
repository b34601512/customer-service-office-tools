const fs=require('fs');
const dir='D:/备份文件夹/探域问答审核-20260905';
const cards=JSON.parse(fs.readFileSync(dir+'/image-binding-before.json','utf8'));
const products=JSON.parse(fs.readFileSync(dir+'/image-binding-products-detailed.json','utf8')).results.filter(p=>!['459306283515','447270317346','447222893371','757797487283','730527748818','649371795096','642773291759'].includes(p.spuId));
const shop='2095398963959042048';
const match=(models,s)=>models.some(m=>new RegExp('(^|[^A-Z0-9])'+m+'(?=$|[^A-Z0-9])','i').test(s.attrs.map(a=>a.value).join(' ')));
const scope=models=>{const spu=products.map(p=>({thirdShopId:shop,spuId:p.spuId,skuIds:p.skus.filter(s=>match(models,s)).map(s=>s.skuId)})).filter(p=>p.skuIds.length);return{spu,shop:spu.length?[]:[{thirdShopId:shop,cids:[]}],rules:[],productGroupId:[],sellerGroup:[],platform:[]};};
const plan=[];
function add(id,title,models,text,files=[]){const before=id?cards.find(c=>c.id===id):null;if(id&&!before)throw Error(id);if(before&&!before.ifOpen)throw Error('停用卡');plan.push({id,title:title||before.title,before,includeCondition:scope(models),text:text??before.content.map(c=>c.content).join('\n'),files:files.map(name=>'D:/Pictures/1.过滤器更换教程/'+name)});}
add('6a9a3c41644e354d71a3f8c6',null,['C1','C1L','A1','A1L'],null,['C1系列过滤器干净与脏的对比图.png','C1A1过滤器更换.png']);
add('6a9a3c424a45121da4d7c6ec',null,['Q5L','Y5L','Y5W'],null,['Q5Y5系列过滤棉干净与脏污对比图.png']);
add('6a9a3c424a45121da4d7c6ee',null,['Y300W'],null,['Y300W过滤器更换图.png']);
const safe='操作前先核对完整型号与图中维护口一致，关机拔电；只操作外部过滤维护口，不拆主机外壳，不水洗未标明可水洗的滤材。装齐适配滤器、滤棉和盖子后再使用，不能去掉滤材运行。';
function create(title,models,answer,files){add(null,'过滤器/图示教程/'+title,models,'Q:'+title+'\nA:'+safe+answer,files);}
create('1SW、2SW过滤器更换及新旧对比',[], '取下后部消音盖，更换滤器与环形滤棉，盖回；白色滤材积尘可变深，新旧图不能作为故障责任判定。',['1SW2SW过滤器更换图解.png','1SW或2SW系列干净与脏的对比图.png']);
create('2AW过滤器更换图示',['2AW'],'取下后部杯状过滤盖，换上适配滤器，再装回盖子。',['2AW过滤器更换图解.png']);
create('老版1A过滤器更换图示',[],'仅适用图中老版后部接口，取下滤器后更换；不要套用新版杯状盖步骤。版本不清楚时请发机器后部照片。',['老版1A过滤器更换图示.png']);
create('新版1A过滤器更换图示',[],'仅适用图中新版杯状过滤盖结构，取盖、换滤器、盖回；老版接口不用此图，版本不清楚时请发机器后部照片。',['新版1A过滤器更换图示.png']);
create('Q1、Q2系列过滤器更换图示',['Q1','Q1W','Q2','Q2L'],'取下图示后部杯状过滤盖，换上适配滤器，再装回盖子。',['Q1Q2过滤器更换图.png']);
create('Q3L二级过滤器及外滤网位置',['Q3L'],'二级滤器在图示侧面维护口，外滤网在背部下方盖内；二者不同，请按对应位置检查积尘、清理外网灰尘或更换适配滤材。注意避免湿化瓶水洒入机器。',['Q3L二级过滤位置.png','Q3L过滤网更换.png']);
create('Q5L过滤网盖安装图示',['Q5L'],'按图示先将固定一侧卡榫装入，再轻按另一侧扣合；注意盖子有边的朝向，扣不上请发照片，不要硬压。',['Q5L过滤棉安装盖子.png']);
create('Y5无后缀图示版本二级滤材及外网盖',[],'本图文件仅标Y5，需核对相同外观，不按名称推定所有Y5L/Y5W通用。二级为棉套和棉条，标签300小时为检查参考，按实际更换；外网盖先卡入一侧再按另一侧。',['Y5过二级过滤（滤棉套+过滤棉条）.png','Y5过滤网安装方法.png']);
create('Y5W二级滤材更换及外网盖安装',['Y5W'],'二级棉套和棉条从图示维护口更换，300小时为检查参考，按实际更换；黑棉条本色不是脏污。外网盖先卡入一侧再按另一侧，不能硬压。',['Y5W二级过滤器更换.png','Y5W过滤网安装方法.png']);
create('Y5AW过滤盒位置图示',['Y5AW'],'过滤盒位于图示机身后侧，从标出的外部维护口打开，核对适配滤材后更换并盖回；此图不包含盒内拆解步骤。',['Y5AW过滤器安装位置.png']);
for(const [id,models] of [
 ['6a9a3c474a45121da4d7c7ec',['Y300W']],['6a9a3c474a45121da4d7c7e9',['C1']],['6a9a3c474a45121da4d7c7e6',['A1']],['6a9a3c474a45121da4d7c7e5',['1A']],['6a9a3c474a45121da4d7c7e4',['Q1','Q1W','Q2','Q2L']],['6a9a3c474a45121da4d7c7f0',['Q5L']],['6a9a3c47644e354d71a3f9d4',['Y5W']],['6a9a3c47644e354d71a3f9d0',['Q10L']],['6a9a3c47644e354d71a3f9cf',['Y5L']],['6a9a3c47644e354d71a3f9cd',['Q3L']],['6a9a3c47644e354d71a3f9c9',['2AW']],['6a9a3c47644e354d71a3f9c6',['1LW']]
]){if(scope(models).spu.length)add(id,null,models,null);}
for(const p of plan){if(p.text.length>300)throw Error('超长 '+p.title);if(!p.before&&cards.some(c=>c.title===p.title))throw Error('重名 '+p.title);}
fs.writeFileSync(dir+'/image-binding-plan.json',JSON.stringify(plan,null,2));
console.log(JSON.stringify(plan.map(p=>({id:p.id,title:p.title,images:p.files.length,products:p.includeCondition.spu.map(s=>({spu:s.spuId,sku:s.skuIds}))})),null,2));
