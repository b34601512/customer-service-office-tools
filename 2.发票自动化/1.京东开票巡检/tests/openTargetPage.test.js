const test = require('node:test');
const assert = require('node:assert/strict');

const { 打开目标页面 } = require('../src/browser/openTargetPage');

class FakePage {
  constructor() {
    this.gotoCalls = [];
    this.waitForFunctionCalled = false;
  }

  async goto(url, options) {
    // 解决：记录开页参数，验证开页阶段只做导航不做正文等待。
    this.gotoCalls.push({ url, options });
  }

  async waitForFunction() {
    // 解决：如果旧的 15 秒正文等待被重新引入，测试会立刻暴露。
    this.waitForFunctionCalled = true;
    throw new Error('不应该在开页阶段等待正文');
  }
}

class FakeContext {
  constructor(page) {
    this.page = page;
  }

  pages() {
    // 解决：模拟持久化上下文已经带有一个页面的真实场景。
    return [this.page];
  }

  async newPage() {
    // 解决：如果测试走到新建页面分支，直接返回同一个假页面。
    return this.page;
  }
}

test('打开目标页面只等待导航状态，不再调用正文 waitForFunction', async () => {
  const page = new FakePage();
  const context = new FakeContext(page);

  const resultPage = await 打开目标页面(context, 'https://example.com/demo');

  assert.equal(resultPage, page);
  assert.equal(page.gotoCalls.length, 1);
  assert.equal(page.gotoCalls[0].options.waitUntil, 'domcontentloaded');
  assert.equal(page.waitForFunctionCalled, false);
});
