const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const childProcess = require('node:child_process');
const { chromium } = require('playwright');

test('同手机号连续处理两店只启动一个浏览器，不同手机号单独启动', async (t) => {
  t.mock.method(childProcess, 'spawnSync', () => ({ status: 0, stdout: '', stderr: '' }));
  const browser = require('../src/browser/douyinBrowserContext');
  t.mock.method(fs, 'mkdirSync', () => {});
  t.mock.method(fs, 'existsSync', () => false);
  const contexts = [];
  t.mock.method(chromium, 'launchPersistentContext', async () => {
    let closed = false;
    let onClose;
    const context = {
      pages: () => [],
      isClosed: () => closed,
      setDefaultTimeout: () => {},
      once: (_, callback) => { onClose = callback; },
      close: async () => { closed = true; onClose(); },
    };
    contexts.push(context);
    return context;
  });
  try {
    const first = await browser.创建抖音账号浏览器上下文({ id: 'a', phoneNumber: '13800138000' });
    const second = await browser.创建抖音账号浏览器上下文({ id: 'b', phoneNumber: '13800138000' });
    assert.equal(first, second);
    assert.equal(contexts.length, 1);
    const third = await browser.创建抖音账号浏览器上下文({ id: 'c', phoneNumber: '13900139000' });
    assert.notEqual(first, third);
    assert.equal(contexts.length, 2);
    await first.close();
    const reopened = await browser.创建抖音账号浏览器上下文({ id: 'b', phoneNumber: '13800138000' });
    assert.notEqual(reopened, first);
  } finally {
    await browser.关闭所有已打开抖音浏览器上下文();
  }
});

test('批量登录同手机号验证一次，并保留各店结果', async (t) => {
  const config = require('../src/store/storeConfigService');
  const browser = require('../src/browser/douyinBrowserContext');
  const auth = require('../src/browser/douyinAuthenticatedPage');
  const commonFs = require('../src/common/fs');
  const stores = [
    { id: 'a', name: 'A', phoneNumber: '13800138000' },
    { id: 'b', name: 'B', phoneNumber: '13800138000' },
    { id: 'c', name: 'C', phoneNumber: '13900139000' },
  ];
  t.mock.method(config, '获取启用店铺列表', () => stores);
  t.mock.method(commonFs, '初始化运行目录', () => {});
  t.mock.method(browser, '创建抖音账号浏览器上下文', async (store) => ({ __douyinAccountProfilePath: store.phoneNumber }));
  t.mock.method(browser, '获取或打开抖音页面', async () => ({}));
  const login = t.mock.method(auth, '等待抖音登录完成', async () => true);
  const { 登录全部启用抖音店铺 } = require('../src/app/loginStores');
  const results = await 登录全部启用抖音店铺();
  assert.equal(login.mock.callCount(), 2);
  assert.deepEqual(results.map((r) => r.storeId), ['a', 'b', 'c']);
  assert.equal(results[0].profilePath, results[1].profilePath);
});
