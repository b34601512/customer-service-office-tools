import { chromium } from 'playwright';
const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', {
  channel: 'msedge',
  headless: false,
  args: ['--start-maximized']
});
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('http://agent.tanyuai.com/v2/dashboard');
console.log('READY-EDGE-AUTO');
await new Promise(()=>{});
