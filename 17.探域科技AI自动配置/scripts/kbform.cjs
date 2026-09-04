const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^知识库$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /新建知识/ }).click({ timeout: 8000 });
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.ant-modal input, .ant-drawer input, input[placeholder]')).map(i => ({ tag: i.tagName, ph: (i.placeholder || '').slice(0, 20), cls: (i.className || '').slice(0, 60) }));
    const tas = Array.from(document.querySelectorAll('.ant-modal textarea, .ant-drawer textarea')).map(t => ({ ph: (t.placeholder || '').slice(0, 30) }));
    const scripts = Array.from(document.scripts).map(s => s.src).filter(s => s.includes('assets')).slice(0, 5);
    return JSON.stringify({ els: els.slice(0, 10), tas: tas.slice(0, 5), scripts });
  });
  fs.writeFileSync('C:/Users/b3460/.pi-edge-work/kb-form.txt', info, 'utf8');
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/kb-dialog2.png' });
  console.log('FORM-DUMPED');
  console.log('DONE');
  await ctx.close();
})();
