const { EventEmitter } = require('events');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  注册浏览器上下文,
  关闭店铺浏览器上下文,
  关闭全部浏览器上下文,
  获取活动浏览器上下文数量,
} = require('../src/browser/browserContextHub');

class FakeBrowserContext extends EventEmitter {
  constructor() {
    super();
    this.closeCount = 0;
  }

  async close() {
    // 解决：模拟 Playwright 上下文关闭行为，让测试能验证集中回收是否生效。
    this.closeCount += 1;
    this.emit('close');
  }
}

test('关闭全部浏览器上下文会关闭所有已登记窗口', async () => {
  await 关闭全部浏览器上下文();
  const contextA = new FakeBrowserContext();
  const contextB = new FakeBrowserContext();

  注册浏览器上下文(contextA, { 店铺名称: '店铺A' });
  注册浏览器上下文(contextB, { 店铺名称: '店铺B' });
  assert.equal(获取活动浏览器上下文数量(), 2);

  await 关闭全部浏览器上下文();

  assert.equal(contextA.closeCount, 1);
  assert.equal(contextB.closeCount, 1);
  assert.equal(获取活动浏览器上下文数量(), 0);
});

test('关闭店铺浏览器上下文只会关闭指定店铺的旧窗口', async () => {
  await 关闭全部浏览器上下文();
  const contextA = new FakeBrowserContext();
  const contextB = new FakeBrowserContext();

  注册浏览器上下文(contextA, { 店铺名称: '店铺A', 店铺标识: 'store-a' });
  注册浏览器上下文(contextB, { 店铺名称: '店铺B', 店铺标识: 'store-b' });

  await 关闭店铺浏览器上下文('store-a');

  assert.equal(contextA.closeCount, 1);
  assert.equal(contextB.closeCount, 0);
  await 关闭全部浏览器上下文();
});
