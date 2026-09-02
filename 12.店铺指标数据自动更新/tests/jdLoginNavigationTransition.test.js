const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isJdLoginNavigationTransitionError,
  runJdLoginStateStep
} = require("../src/platforms/jd/loginAssistParts/jdLoginNavigationTransition");

test("京东登录重定向销毁旧上下文时等待下一轮状态读取", async () => {
  const waits = [];
  const result = await runJdLoginStateStep(
    async () => {
      throw new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation");
    },
    {
      transitionWaitMs: 120,
      async waitFn(waitMs) {
        waits.push(waitMs);
      }
    }
  );

  assert.equal(result.completed, false);
  assert.deepEqual(waits, [120]);
  assert.equal(isJdLoginNavigationTransitionError(result.transitionMessage), true);
});

test("京东登录状态读取的真实故障仍原样抛出", async () => {
  const sourceError = new Error("page.evaluate: 页面脚本执行失败");
  await assert.rejects(
    runJdLoginStateStep(async () => {
      throw sourceError;
    }),
    (error) => error === sourceError
  );
});

test("京东登录状态读取成功时保留结果", async () => {
  const result = await runJdLoginStateStep(async () => ({ ready: true }));
  assert.deepEqual(result, {
    completed: true,
    value: { ready: true }
  });
});
