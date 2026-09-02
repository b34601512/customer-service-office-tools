const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  解析店铺浏览器参数,
  构建浏览器启动参数,
  规范化浏览器启动地址,
} = require('../src/browser/storeBrowser');
const { 构建新上下文选项 } = require('../src/browser/storeBrowser/contextFactory');
const { 保存店铺浏览器登录态 } = require('../src/browser/storeBrowser/authStateStore');
const { 绑定浏览器生命周期 } = require('../src/browser/storeBrowser/contextLifecycle');
const { 执行巡检 } = require('../src/app/checkInvoiceUrges');

test('浏览器上下文没有真实店铺标识时会直接报错', () => {
  assert.throws(
    () => 解析店铺浏览器参数({}),
    /必须传入真实店铺标识/
  );
});

test('浏览器上下文会按真实店铺标识生成独立登录态文件', () => {
  const 参数 = 解析店铺浏览器参数({ 店铺标识: '京东1店' });

  assert.equal(参数.店铺标识, '京东1店');
  assert.match(参数.旧浏览器目录, /runtime[\\/]store-profiles[\\/]京东1店$/);
  assert.match(参数.登录态文件路径, /data[\\/]store-auth-states[\\/]京东1店\.json$/);
});

test('浏览器启动参数不会携带页面链接', () => {
  const targetUrl = 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder';
  const 参数列表 = 构建浏览器启动参数(targetUrl);

  assert.equal(参数列表.includes(targetUrl), false);
  assert.ok(参数列表.includes('--disable-blink-features=AutomationControlled'));
  assert.ok(参数列表.includes('--disable-component-update'));
  assert.ok(参数列表.includes('--disk-cache-size=1048576'));
});

test('浏览器启动地址只允许网页链接', () => {
  assert.throws(
    () => 规范化浏览器启动地址('--disable-web-security'),
    /必须是 http 或 https/
  );
});

test('新浏览器上下文只加载登录态文件，不依赖完整用户目录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-auth-state-'));
  const authStatePath = path.join(dir, 'store-a.json');
  fs.writeFileSync(authStatePath, JSON.stringify({ cookies: [], origins: [] }), 'utf8');

  const options = 构建新上下文选项(authStatePath);

  assert.equal(options.storageState, authStatePath);
  assert.equal(options.locale, 'zh-CN');
  assert.deepEqual(options.viewport, { width: 1440, height: 960 });
  assert.equal(Object.hasOwn(options, 'userDataDir'), false);
});

test('保存店铺浏览器登录态会写入独立 JSON 文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-save-auth-state-'));
  const authStatePath = path.join(dir, 'nested', 'store-a.json');
  const context = {
    async storageState(options) {
      fs.mkdirSync(path.dirname(options.path), { recursive: true });
      fs.writeFileSync(options.path, JSON.stringify({ cookies: [{ name: 'pin' }], origins: [] }), 'utf8');
      return { cookies: [], origins: [] };
    },
  };

  await 保存店铺浏览器登录态(context, authStatePath);

  assert.equal(fs.existsSync(authStatePath), true);
  assert.match(fs.readFileSync(authStatePath, 'utf8'), /pin/);
});

test('关闭临时上下文会同步关闭浏览器进程', async () => {
  const calls = [];
  const context = {
    async close() {
      calls.push('context');
    },
  };
  const browser = {
    isConnected() {
      return true;
    },
    async close() {
      calls.push('browser');
    },
  };

  const wrapped = 绑定浏览器生命周期(context, browser);
  await wrapped.close();
  await wrapped.close();

  assert.deepEqual(calls, ['context', 'browser']);
});

test('巡检入口没有真实店铺配置时会直接报错', async () => {
  await assert.rejects(
    () => 执行巡检({}),
    /必须传入真实店铺配置/
  );
});
