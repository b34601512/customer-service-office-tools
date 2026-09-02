const test = require('node:test');
const assert = require('node:assert/strict');

const { 等待直到 } = require('../src/browser/dynamicWait');

class FakePage {
  constructor() {
    this.waitCount = 0;
  }

  async waitForTimeout() {
    // 解决：在测试里用可计数的空等待代替真实时间流逝，验证轮询次数即可。
    this.waitCount += 1;
  }
}

test('等待直到会在条件满足后立即返回，不会继续盲等', async () => {
  const page = new FakePage();
  let 检查次数 = 0;

  const 结果 = await 等待直到(page, async () => {
    // 解决：模拟慢一拍才出现的目标状态，确认轮询逻辑能持续等到它出现。
    检查次数 += 1;
    if (检查次数 === 3) {
      return 'READY';
    }
    return '';
  }, {
    timeoutMs: 50,
    intervalMs: 1,
    超时消息: '不应该超时',
  });

  assert.equal(结果, 'READY');
  assert.equal(检查次数, 3);
  assert.equal(page.waitCount, 2);
});

test('等待直到超时时会抛出明确中文错误', async () => {
  const page = new FakePage();

  await assert.rejects(
    () => 等待直到(page, async () => false, {
      timeoutMs: 10,
      intervalMs: 1,
      超时消息: '等待登录表单出现超时',
    }),
    /等待登录表单出现超时/,
  );
});
