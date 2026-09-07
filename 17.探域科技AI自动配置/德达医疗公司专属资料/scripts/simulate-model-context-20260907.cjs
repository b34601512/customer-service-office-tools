const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');

const tests = [
  { key: 'product-context', q: '这个可以加水吗？' },
  { key: 'explicit-c1l', q: '我咨询的是C1L，这款可以加水吗？' },
  { key: 'follow-up', q: '我刚才已经说明是C1L了，为什么还问型号？' }
];

(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: true });
  try {
    for (const t of tests) {
      const page = await ctx.newPage();
      await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
      await page.getByText('选择商品', { exact: true }).click({ timeout: 10000 });
      const radios = page.locator('.ant-modal input[type=radio]');
      await radios.first().check({ timeout: 10000 });
      await page.waitForTimeout(600);
      const sels = page.locator('.ant-modal .ant-select:not(.ant-select-disabled)');
      await sels.first().click({ timeout: 10000 });
      await page.waitForTimeout(300);
      await sels.first().press('ArrowDown');
      await sels.first().press('Enter');
      await page.locator('.ant-modal .ant-btn-primary').last().click({ timeout: 10000 });
      await page.waitForTimeout(800);
      const box = page.getByPlaceholder('模拟买家，输入您的问题', { exact: true });
      await box.fill(t.q);
      await box.press('Enter');
      await page.waitForTimeout(30000);
      const body = await page.locator('body').innerText();
      console.log(JSON.stringify({ key: t.key, tail: body.slice(-2500) }));
      await page.close();
    }
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
