const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const 引擎 = require('./index.js');

const 假页 = (url) => ({
  已关: false,
  url: () => url,
  去过: null,
  isClosed() { return this.已关; },
  async goto(u) { this.去过 = u; },
  async bringToFront() {},
});

test('sleep：到点就返回', async () => {
  const t0 = Date.now();
  await 引擎.sleep(30);
  assert.ok(Date.now() - t0 >= 25);
});

test('isPortFree：占着的端口 = false，放开后 = true', async () => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.equal(await 引擎.isPortFree(port), false);
  await new Promise((r) => server.close(r));
  assert.equal(await 引擎.isPortFree(port), true);
});

test('acquireDebugPort：首选端口被占就往后挪；连续 20 个都占就报错', async () => {
  assert.equal(await 引擎.acquireDebugPort(9110, async (p) => p === 9112), 9112);
  await assert.rejects(() => 引擎.acquireDebugPort(9110, async () => false), /连续 20 个都被占用/);
});

test('firstPage：同域的已开页复用（只 goto，不新开），不同域才开新页', async () => {
  const 老页 = 假页('https://example.com/a');
  let 新开 = 0;
  const context = {
    pages: () => [老页],
    newPage: async () => { 新开 += 1; return 假页('about:blank'); },
  };
  const 复用 = await 引擎.firstPage(context, 'https://example.com/b');
  assert.equal(复用, 老页);
  assert.equal(老页.去过, 'https://example.com/b');
  assert.equal(新开, 0);

  const 新的 = await 引擎.firstPage(context, 'https://other.example.org/x');
  assert.equal(新开, 1);
  assert.equal(新的.去过, 'https://other.example.org/x');
});

test('firstPage：没传地址就返回第一张开着的页；一张都没有才开新页', async () => {
  const 页 = 假页('about:blank');
  assert.equal(await 引擎.firstPage({ pages: () => [页], newPage: async () => 假页('x') }, ''), 页);
  const 空 = { pages: () => [], newPage: async () => 假页('about:blank') };
  assert.equal((await 引擎.firstPage(空, '')).url(), 'about:blank');
});

test('创建：不传 chromium 直接报错（避免各项目壳里忘注入）', () => {
  assert.throws(() => 引擎.创建({ log: () => {} }), /需要传 chromium/);
});

test('attachStoreBrowser：端口上没有调试服务 → 返 null（不猜、不乱接）', async () => {
  const { attachStoreBrowser } = 引擎.创建({ log: () => {}, chromium: { connectOverCDP: async () => { throw new Error('不该走到这'); } } });
  const r = await attachStoreBrowser({ profileDir: 'D:/不存在的店铺profile', port: 59999 });
  assert.equal(r, null);
});

test('反向断言：22/24/25/26 号的 engine/browser.js 只能是薄壳（不许再自带拉起逻辑）', () => {
  const 壳 = [
    '22.后台售后服务单分析/src/engine/browser.js',
    '24.平台退款复查/src/engine/browser.js',
    '25.京东换货登记核查/src/engine/browser.js',
    '26.后台申诉/src/engine/browser.js',
  ];
  const 根 = path.join(__dirname, '..', '..');
  for (const f of 壳) {
    const 源 = fs.readFileSync(path.join(根, f), 'utf8');
    assert.ok(/tools\/浏览器引擎/.test(源), `${f} 应 require 共享引擎`);
    assert.ok(!/spawn\(/.test(源), `${f} 里还在自己 spawn 浏览器，应调用共享引擎`);
    assert.ok(!/execFileSync/.test(源), `${f} 里还在自己查进程，应调用共享引擎`);
    assert.ok(!/remote-debugging-port=/.test(源), `${f} 里还在自己拼启动参数，应调用共享引擎`);
  }
});
