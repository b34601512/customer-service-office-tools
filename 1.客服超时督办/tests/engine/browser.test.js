const test = require("node:test");
const assert = require("node:assert/strict");

const appConfig = require("../../src/config/appConfig");
const { navigateToTargetPage } = require("../../src/engine/browser");
const { DEFAULT_BACKGROUND_POLLING_MS } = require("../../src/engine/pageWait");

function createFakePage() {
  // 这里构造最小页面桩，验证目标页打开逻辑只按页面状态等待，不再依赖固定毫秒。
  const recorder = {
    evaluateCalls: [],
    gotoArguments: [],
    waitForTimeoutCount: 0,
    waitForFunctionArguments: [],
    locatorWaitForCount: 0
  };

  return {
    recorder,
    goto(url, options) {
      recorder.gotoArguments.push({ url, options });
      return Promise.resolve();
    },
    waitForTimeout() {
      recorder.waitForTimeoutCount += 1;
      return Promise.resolve();
    },
    waitForFunction(handler, arg, options) {
      recorder.waitForFunctionArguments.push({
        source: String(handler),
        arg,
        options
      });
      return Promise.resolve();
    },
    evaluate(handler, arg) {
      recorder.evaluateCalls.push({
        source: String(handler),
        arg
      });
      return Promise.resolve();
    },
    locator(selector) {
      assert.equal(selector, "body");
      return {
        waitFor() {
          recorder.locatorWaitForCount += 1;
          return Promise.resolve();
        }
      };
    },
    url() {
      return "https://zan-mh.xiaoshunai.com/main/mock/chat";
    }
  };
}

test("直接跳转目标页时不应该执行固定毫秒等待", async () => {
  const page = createFakePage();

  await navigateToTargetPage(page);

  assert.equal(page.recorder.gotoArguments.length, 1);
  assert.equal(page.recorder.locatorWaitForCount, 1);
  assert.equal(page.recorder.waitForFunctionArguments.length, 1);
  assert.equal(
    page.recorder.waitForFunctionArguments[0].options.polling,
    DEFAULT_BACKGROUND_POLLING_MS
  );
  assert.equal(page.recorder.waitForTimeoutCount, 0);
});

test("后台业务页应该写入清晰的督办窗口标题", async () => {
  const page = createFakePage();

  await navigateToTargetPage(page, "客户转接");

  assert.equal(page.recorder.evaluateCalls.length, 1);
  assert.equal(page.recorder.evaluateCalls[0].arg, "客户转接");
  assert.match(page.recorder.evaluateCalls[0].source, /客服督办/);
  assert.match(page.recorder.evaluateCalls[0].source, /icon/);
});

test("后台运行遇到非完整地址时应该先打开 main 入口复用登录态", async () => {
  const page = createFakePage();
  const originalTargetUrl = appConfig.targetUrl;
  appConfig.targetUrl = "https://zan-mh.xiaoshunai.com/closeLogin";

  try {
    await navigateToTargetPage(page);

    assert.equal(page.recorder.gotoArguments[0].url, "https://zan-mh.xiaoshunai.com/main");
  } finally {
    appConfig.targetUrl = originalTargetUrl;
  }
});
