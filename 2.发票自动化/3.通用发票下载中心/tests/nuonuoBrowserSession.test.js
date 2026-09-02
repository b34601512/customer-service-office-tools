const test = require('node:test');
const assert = require('node:assert/strict');
const {
  构建诺诺浏览器上下文选项,
  创建诺诺浏览器会话,
  创建或复用诺诺浏览器会话,
  关闭共享诺诺浏览器会话,
} = require('../src/nuonuo/nuonuoBrowserSession');
const { 创建诺诺查询页面 } = require('../src/nuonuo/invoiceApiDownloader');

function 创建模拟浏览器({ pageFactory = async () => ({}) } = {}) {
  let contextClosed = 0;
  let browserClosed = 0;
  const context = {
    newPage: pageFactory,
    close: async () => { contextClosed += 1; },
  };
  const browser = {
    newContext: async (options) => {
      return context;
    },
    close: async () => { browserClosed += 1; },
    process: () => ({ pid: 0 }),
  };
  return {
    browser,
    context,
    getCloseCounts: () => ({ contextClosed, browserClosed }),
  };
}

test('诺诺浏览器上下文使用统一登录态文件', () => {
  const options = 构建诺诺浏览器上下文选项({
    authStateFilePath: 'D:\\auth-state.json',
    fileExists: () => true,
    acceptDownloads: true,
  });

  assert.equal(options.storageState, 'D:\\auth-state.json');
  assert.equal(options.acceptDownloads, true);
  assert.deepEqual(options.viewport, { width: 1440, height: 960 });
});

test('浏览器上下文或页面创建失败时会完整清理', async () => {
  const 模拟浏览器 = 创建模拟浏览器({
    pageFactory: async () => {
      throw new Error('页面创建失败');
    },
  });

  await assert.rejects(
    () => 创建诺诺浏览器会话({
      launchBrowser: async () => 模拟浏览器.browser,
      fileExists: () => false,
    }),
    /页面创建失败/,
  );
  assert.deepEqual(模拟浏览器.getCloseCounts(), { contextClosed: 1, browserClosed: 1 });
});

test('下载中心进程内复用同一个诺诺浏览器会话', async () => {
  const 模拟浏览器 = 创建模拟浏览器();
  let 启动次数 = 0;
  const 启动浏览器 = async () => {
    启动次数 += 1;
    return 模拟浏览器.browser;
  };

  const 第一个会话 = await 创建或复用诺诺浏览器会话({
    launchBrowser: 启动浏览器,
    fileExists: () => false,
  });
  const 第二个会话 = await 创建或复用诺诺浏览器会话({
    launchBrowser: 启动浏览器,
    fileExists: () => false,
  });

  assert.equal(第一个会话, 第二个会话);
  assert.equal(启动次数, 1);
  await 关闭共享诺诺浏览器会话();
  assert.deepEqual(模拟浏览器.getCloseCounts(), { contextClosed: 1, browserClosed: 1 });
});

test('诺诺查询页面导航失败时会关闭已启动会话', async () => {
  const 模拟浏览器 = 创建模拟浏览器({
    pageFactory: async () => ({
      goto: async () => { throw new Error('导航失败'); },
      waitForLoadState: async () => {},
      url: () => 'https://work.nuonuo.com/index',
    }),
  });

  await assert.rejects(
    () => 创建诺诺查询页面({
      authStateFileExists: () => true,
      createBrowserSession: async () => ({
        browser: 模拟浏览器.browser,
        context: 模拟浏览器.context,
        page: await 模拟浏览器.context.newPage(),
      }),
    }),
    /导航失败/,
  );
  assert.deepEqual(模拟浏览器.getCloseCounts(), { contextClosed: 1, browserClosed: 1 });
});
