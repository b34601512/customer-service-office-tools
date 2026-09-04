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
  // 对话框确定:找弹窗内主按钮
  await page.locator('.ant-modal .ant-btn-primary').last().click({ timeout: 8000 });
  console.log('USERS-OK');
  await page.waitForTimeout(2500);
  // 全自动行绑定店铺
  const bindBtns = page.locator('button:has-text("绑定店铺/类目")');
  await bindBtns.first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);
  await page.locator('label:has-text("全店")').first().click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/shop-all.png' });
  await page.locator('.ant-modal .ant-btn-primary').last().click({ timeout: 8000 });
  console.log('SHOP-OK');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/strategy-done.png' });
  await page.getByRole('button', { name: /^保\s*存$/ }).first().click({ timeout: 8000 });
  console.log('SAVED');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'C:/Users/b3460/.pi-edge-work/strategy-saved.png' });
  console.log('DONE');
  await ctx.close();
})();
