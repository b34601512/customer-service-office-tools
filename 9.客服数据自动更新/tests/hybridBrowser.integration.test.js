// 仅使用虚构 DOM、虚构 cookie 和路由拦截；不访问真实店铺、不读取本机业务配置。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { chromium } = require('playwright-core');
const { installBrowserPopupGuard } = require('../src/engine/browserPopupGuard');
const { registerAutomationBrowser } = require('../src/engine/browserAutomationScope');
const { checkBrowserHumanRequirement } = require('../src/engine/browserHumanGuard');
const { runHybridSourceDownload } = require('../src/summary/storeSummaryParts/hybridSourceRunner');
const { waitForDownloadArtifactState } = require('../src/shared/downloadEventEngine');
const { requestChromeCloseOverCDP } = require('../src/engine/chromeSessionParts/chromeHeadlessCloser');
const { readCurrentTmallShopName } = require('../src/platforms/tmall/storeSwitcherParts/tmallCurrentShopReader');
const { ensureDouyinStoreMenuOpen } = require('../src/platforms/douyin/downloadTaskParts/douyinStoreMenu');

const chromeOptions = process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' };
const base = 'https://kf.jd.com/fixture';
async function eventually(check, milliseconds = 5000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  assert.fail('fixture condition did not become true');
}
async function fixture(t, html) {
  const browser = await chromium.launch({ ...chromeOptions, headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  const page = await context.newPage();
  await page.goto(base);
  assert.equal(await page.evaluate(() => document.characterSet), 'UTF-8');
  await installBrowserPopupGuard(browser);
  return { browser, context, page };
}
const overlayStyle = 'position:fixed;inset:0;background:white;z-index:9999;display:flex;align-items:center;justify-content:center';

test('real headless Chrome closes a blocking known promotion and performs the business action once', async t => {
  const { page } = await fixture(t, `<button id="export" onclick="window.exports=(window.exports||0)+1">导出报表</button>
    <section id="ad" role="dialog" style="${overlayStyle}">限时优惠 立即开通<button aria-label="关闭" onclick="this.parentNode.remove()">×</button></section>`);
  await page.locator('#export').click({ timeout: 10000 });
  assert.equal(await page.locator('#ad').count(), 0);
  assert.equal(await page.evaluate(() => window.exports), 1);
});
test('real export and safety dialogs are not mistaken for advertisements', async t => {
  const { page } = await fixture(t, `<section id="confirmation" role="dialog">确认导出 立即体验
    <button id="confirm" onclick="window.confirmed=true">确认</button><button aria-label="关闭" onclick="this.parentNode.remove()">×</button></section>
    <section id="security" role="dialog">安全验证 立即体验<button aria-label="关闭" onclick="this.parentNode.remove()">×</button></section>`);
  await page.locator('#confirm').click();
  assert.equal(await page.locator('#confirmation').count(), 1);
  assert.equal(await page.locator('#security').count(), 1);
  assert.equal(await page.evaluate(() => window.confirmed), true);
});
test('late ad navigation is closed while legitimate login, export and blank tabs remain', async t => {
  const { context } = await fixture(t, '<p>fixture</p>');
  const ad = await context.newPage();
  await ad.goto('https://ad.doubleclick.net/banner').catch(error => {
    if (!/closed|ERR_ABORTED/i.test(error.message)) throw error;
  });
  await eventually(() => ad.isClosed());
  for (const url of ['https://passport.jd.com/new/login', 'https://kf.jd.com/export', 'about:blank']) {
    const legitimate = await context.newPage();
    await legitimate.goto(url);
    assert.equal(legitimate.isClosed(), false);
  }
});
test('real headless browser writes a download to the selected directory', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project9-download-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { context, page } = await fixture(t, '<a id="export" href="/fixture.csv">导出</a>');
  await context.route('**/fixture.csv', route => route.fulfill({
    contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="fixture.csv"' }, body: 'name,value\nfixture,1\n'
  }));
  const cdp = await context.newCDPSession(page);
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  // 此夹具是隔离上下文；生产浏览器为默认持久上下文，不能混用下载策略作用域。
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow', downloadPath: directory,
    ...(targetInfo.browserContextId ? { browserContextId: targetInfo.browserContextId } : {})
  });
  await page.locator('#export').click();
  const filename = path.join(directory, 'fixture.csv');
  assert.equal(await waitForDownloadArtifactState(() => fs.existsSync(filename) ? filename : null, 10000, 50), filename);
  assert.match(fs.readFileSync(filename, 'utf8'), /fixture,1/);
});
test('Tmall shop reader waits for the canonical header after login hydration', async t => {
  const { page } = await fixture(t, `<title>生意参谋</title><main>登录已完成，业务框架渲染中</main>
    <script>
      setTimeout(() => {
        const title = document.createElement('span');
        title.className = 'Frame-module-title_fixture';
        title.textContent = '天猫2店';
        document.body.appendChild(title);
      }, 350);
    </script>`);
  assert.equal(await readCurrentTmallShopName(page, 3000), '天猫2店');
});
test('Douyin store menu retries the same safe header after login hydration', async t => {
  const { page } = await fixture(t, `<div class="headerShopName"><span data-bytereplay-mask="true">DEDAKJ医疗器械旗舰店</span></div>
    <script>
      setTimeout(() => {
        document.querySelector('.headerShopName').addEventListener('click', () => {
          if (document.querySelector('#store-menu')) return;
          const menu = document.createElement('section');
          menu.id = 'store-menu';
          menu.append('店铺ID 162329841 ');
          const switchEntry = document.createElement('button');
          switchEntry.textContent = '切换组织/店铺';
          menu.appendChild(switchEntry);
          document.body.appendChild(menu);
        });
      }, 350);
    </script>`);
  const entry = await ensureDouyinStoreMenuOpen(page);
  assert.equal(await entry.innerText(), '切换组织/店铺');
  assert.equal(await page.locator('#store-menu').count(), 1);
});
test('real Windows Chrome handoff reuses the profile without simultaneous ownership', { skip: process.platform !== 'win32' }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project9-profile-'));
  let context; let page; let opens = 0; let attempts = 0;
  t.after(async () => { await context?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  async function open(headless) {
    context = await chromium.launchPersistentContext(directory, { ...chromeOptions, headless, serviceWorkers: 'block' });
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<p id="challenge">请完成安全验证</p><button id="done" onclick="document.querySelector(\'#challenge\').remove()">完成验证</button>' }));
    page = await context.newPage(); await page.goto(base);
    assert.equal(await page.evaluate(() => document.characterSet), 'UTF-8');
  }
  await open(true);
  await context.addCookies([{ name: 'fixture_cookie', value: 'not-a-real-session', domain: 'kf.jd.com', path: '/', expires: Date.now() / 1000 + 3600 }]);
  const result = await runHybridSourceDownload({
    platformKey: 'jd', mode: 'hybrid', headless: true, humanTimeoutMs: 5000,
    async openHeaded() {
      opens++; await context.close(); await open(false);
      assert.ok((await context.cookies()).some(cookie => cookie.name === 'fixture_cookie'));
      // 模拟用户在可见浏览器完成验证；不是验证码识别或破解逻辑。
      await page.locator('#done').click();
    }
  }, async () => {
    attempts++; registerAutomationBrowser(context.browser());
    await checkBrowserHumanRequirement({ force: true });
    return 'synthetic-report';
  });
  assert.equal(result, 'synthetic-report'); assert.equal(opens, 1); assert.equal(attempts, 2);
});
test('Browser.close really terminates a headless Chrome reached through CDP', async t => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const browser = await chromium.launch({ ...chromeOptions, headless: true, args: [`--remote-debugging-port=${port}`] });
  t.after(() => browser.close());
  await requestChromeCloseOverCDP(`http://127.0.0.1:${port}`);
  await eventually(() => !browser.isConnected());
});
