const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: false, args: ['--start-maximized'], viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.getByText(/^自动发送场景$/).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /添加策略/ }).click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await page.locator('label:has-text("绑定客服账号")').first().click({ timeout: 8000 });
  await page.waitForTimeout(2000);
  await page.locator('button:has-text("选择客服/分组")').first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);
  await page.locator('label:has-text("全选")').first().click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/bind-all.png' });
  // 点对话框的确定( Nak - 用弹窗内最后一个确定）
  const dlgSure = page.locator('button:has-text("确 定"), button:has-text("确定")').last();
  await dlgSure.click({ timeout: 8000 });
  console.log('USERS-BOUND');
  await page.waitForTimeout(2500);
  // 全自动行绑定店铺/类目
  const bindShopBtns = page.locator('button:has-text("绑定店铺/类目")');
  console.log('BINDSHOP-COUNT', await bindShopBtns.count());
  await bindShopBtns.first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/bind-shop.png' });
  const t = await page.evaluate(() => document.body.innerText.slice(-800));
  console.log('SHOPDIALOG', JSON.stringify(t).slice(0, 600));
  console.log('DONE');
  await ctx.close();
})();
