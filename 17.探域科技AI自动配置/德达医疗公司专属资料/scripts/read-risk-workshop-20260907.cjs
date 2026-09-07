const fs=require('fs');
const {chromium}=require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const dir='D:/备份文件夹/探域问答审核-20260905';
(async()=>{const ctx=await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto',{channel:'msedge',headless:true});try{
const page=ctx.pages()[0]||await ctx.newPage();const logs=[];
page.on('response',async r=>{if(r.url().includes('/api/')&&!/token|login|profile|user\/info/i.test(r.url())){try{logs.push({url:r.url(),method:r.request().method(),data:r.request().postData(),response:await r.json()});}catch{}}});
await page.goto('http://agent.tanyuai.com/v2/diagnostic-optimization/optimization-workshop',{waitUntil:'networkidle',timeout:45000});
await page.getByText('请选择未自动发送原因',{exact:true}).locator('..').click();
await page.getByText('风控话术拦截',{exact:true}).click();
await page.keyboard.press('Escape');
await page.getByRole('button',{name:'刷 新'}).click();
await page.waitForTimeout(1500);
await page.waitForLoadState('networkidle');
await page.getByText('要最好的那-款',{exact:true}).first().click();
await page.waitForTimeout(1200);
console.log((await page.locator('body').innerText()).slice(0,13000));
fs.writeFileSync(dir+'/risk-workshop-20260907-detail-probe.json',JSON.stringify(logs,null,2));
console.log('REQUESTS',logs.map(x=>({url:x.url,data:x.data}))); 
}finally{await ctx.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
