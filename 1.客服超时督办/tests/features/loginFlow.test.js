const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const appConfig = require("../../src/config/appConfig");
const { readLoginStatus } = require("../../src/features/loginStatusStore");

const {
  completeLoginMode,
  ensureLoginReadyForRun,
  isLoginRequiredError,
  persistCurrentTargetUrlIfReady
} = require("../../src/features/loginFlow");

function createFakePage() {
  // 这里构造最小页面桩，专门验证登录流程是否按预期触发前台与刷新动作。
  return {
    broughtToFrontCount: 0,
    bringToFront() {
      this.broughtToFrontCount += 1;
      return Promise.resolve();
    }
  };
}

async function withTempLoginStatusPath(callback) {
  // 这里隔离登录态状态文件，避免单元测试污染生产运行目录。
  const originalLoginStatusPath = appConfig.loginStatusPath;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "login-status-"));
  appConfig.loginStatusPath = path.join(tempRoot, "login-status.json");

  try {
    return await callback(appConfig.loginStatusPath);
  } finally {
    appConfig.loginStatusPath = originalLoginStatusPath;
  }
}

test("后台启动遇到未登录时应自动转入人工登录并在确认后继续", async () => {
  await withTempLoginStatusPath(async (loginStatusPath) => {
    const page = createFakePage();
    const originalTargetUrl = appConfig.targetUrl;
    let assertCount = 0;
    let confirmationCount = 0;
    let loginEntryCount = 0;
    let reloadCount = 0;

    appConfig.targetUrl = "https://zan-mh.xiaoshunai.com/main/mock-org/mock-group/chat";

    try {
      const result = await ensureLoginReadyForRun(page, {
        assertPageReady: async () => {
          // 这里先模拟首次检查命中未登录，再模拟登录完成后的复检成功。
          assertCount += 1;
          if (assertCount === 1) {
            throw new Error("当前登录态已失效，请点击控制台里的「首次登录」重新登录。");
          }
        },
        waitForConfirmation: async () => {
          confirmationCount += 1;
        },
        openLoginEntryPage: async () => {
          loginEntryCount += 1;
        },
        reloadTargetPage: async () => {
          reloadCount += 1;
        }
      });

      assert.equal(result, "login_completed");
      assert.equal(assertCount, 2);
      assert.equal(confirmationCount, 1);
      assert.equal(loginEntryCount, 1);
      assert.equal(reloadCount, 1);
      assert.equal(page.broughtToFrontCount, 1);
      assert.equal(readLoginStatus(loginStatusPath).isValid, true);
    } finally {
      appConfig.targetUrl = originalTargetUrl;
    }
  });
});

test("后台启动在已登录时不应触发人工登录", async () => {
  await withTempLoginStatusPath(async (loginStatusPath) => {
    const page = createFakePage();
    let confirmationCount = 0;

    const result = await ensureLoginReadyForRun(page, {
      assertPageReady: async () => {},
      waitForConfirmation: async () => {
        confirmationCount += 1;
      }
    });

    assert.equal(result, "ready");
    assert.equal(confirmationCount, 0);
    assert.equal(page.broughtToFrontCount, 0);
    assert.equal(readLoginStatus(loginStatusPath).isValid, true);
  });
});

test("显式首次登录在登录态仍有效时应直接复用", async () => {
  await withTempLoginStatusPath(async (loginStatusPath) => {
    const page = createFakePage();
    let confirmationCount = 0;

    const result = await completeLoginMode(page, {
      assertPageReady: async () => {},
      waitForConfirmation: async () => {
        confirmationCount += 1;
      }
    });

    assert.equal(result, "already_logged_in");
    assert.equal(confirmationCount, 0);
    assert.equal(page.broughtToFrontCount, 0);
    assert.equal(readLoginStatus(loginStatusPath).isValid, true);
  });
});

test("登录态异常判断应只识别登录失效错误", () => {
  assert.equal(isLoginRequiredError(new Error("当前登录态已失效，请点击控制台里的「首次登录」重新登录。")), true);
  assert.equal(isLoginRequiredError(new Error("聊天工作台加载超时")), false);
});

test("人工登录完成后应该自动捕获当前聊天工作台地址", () => {
  const originalTargetUrl = appConfig.targetUrl;
  const originalConfigPath = appConfig.appRuntimeConfigPath;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "login-flow-config-"));
  const capturedUrl = "https://zan-mh.xiaoshunai.com/main/new-org/new-group/chat";

  appConfig.targetUrl = "https://zan-mh.xiaoshunai.com/";
  appConfig.appRuntimeConfigPath = path.join(tempRoot, "app-config.json");

  try {
    const captured = persistCurrentTargetUrlIfReady({
      url: () => capturedUrl
    });

    assert.equal(captured, true);
    assert.equal(appConfig.targetUrl, capturedUrl);
    assert.match(fs.readFileSync(appConfig.appRuntimeConfigPath, "utf8"), /new-org/);
  } finally {
    appConfig.targetUrl = originalTargetUrl;
    appConfig.appRuntimeConfigPath = originalConfigPath;
  }
});
