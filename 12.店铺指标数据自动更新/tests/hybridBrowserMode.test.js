const test = require("node:test");
const assert = require("node:assert/strict");
const appConfig = require("../src/config/appConfig");
const {
  resolveBrowserMode,
  resolveHumanTimeoutMs,
  runInAutomationScope,
  getAutomationScope,
  requireHeadedBrowser
} = require("../src/engine/browserAutomationScope");
const { runHybridStoreCollection } = require("../src/shared/hybridStoreCollectionRunner");
const { runManagedOpenWindowEngine } = require("../src/shared/managedOpenWindowEngine");
const { buildManagedChromeLaunchArgs } = require("../src/engine/chromeLaunchArgs");
const { buildManagedChromeSessionMeta } = require("../src/engine/chromeSessionParts/chromeSessionPaths");
const { requestChromeCloseOverCDP } = require("../src/engine/chromeSessionParts/chromeHeadlessCloser");
const { waitForTmallLoginReady } = require("../src/platforms/tmall/tmallLoginState");
const { waitForPddLoginReady } = require("../src/platforms/pdd/pddLoginState");

const launchOptions = {
  remoteDebuggingPort: 9334,
  userDataDir: "C:\\fixture-edge-profile",
  targetUrl: "https://kf.jd.com/fixture"
};

function createScope(extra = {}) {
  return {
    platformKey: "jd",
    headless: true,
    humanTimeoutMs: 1000,
    isShutdownRequested: () => false,
    ...extra
  };
}

test("浏览器模式和人工等待时间拒绝静默纠错", () => {
  assert.equal(resolveBrowserMode(""), "hybrid");
  for (const mode of ["hybrid", "headed", "headless"]) {
    assert.equal(resolveBrowserMode(mode), mode);
  }
  assert.throws(() => resolveBrowserMode("headles"), /模式无效/);
  assert.equal(resolveHumanTimeoutMs("1000"), 1000);
  assert.equal(resolveHumanTimeoutMs(""), 180000);
  assert.throws(() => resolveHumanTimeoutMs("900001"), /整数毫秒/);
});

test("Edge-only 配置不包含 Chrome 路径", () => {
  assert.ok(Array.isArray(appConfig.edgePaths) && appConfig.edgePaths.length > 0);
  assert.equal(Object.prototype.hasOwnProperty.call(appConfig, "chromePaths"), false);
  assert.ok(appConfig.edgePaths.every((filePath) => /Microsoft[\\/]Edge[\\/]Application[\\/]msedge\.exe$/i.test(filePath)));
});

test("有头和无头 Edge 启动参数明确分流", () => {
  const headedArgs = buildManagedChromeLaunchArgs(launchOptions);
  assert.ok(headedArgs.includes("--start-maximized"));
  assert.ok(headedArgs.includes("--new-window"));
  assert.equal(headedArgs.some((arg) => arg.startsWith("--headless")), false);

  const headlessArgs = buildManagedChromeLaunchArgs({ ...launchOptions, headless: true });
  assert.ok(headlessArgs.includes("--headless=new"));
  assert.ok(headlessArgs.includes("--window-size=1440,1000"));
  assert.equal(headlessArgs.includes("--new-window"), false);
});

test("会话元信息记录浏览器模式", () => {
  const meta = buildManagedChromeSessionMeta({
    platformKey: "tmall",
    storeKey: "store-1",
    storeDisplayName: "测试店铺",
    userDataDir: "C:\\fixture-edge-profile",
    headless: true,
    browserMode: "hybrid"
  });
  assert.equal(meta.headless, true);
  assert.equal(meta.browserMode, "hybrid");
});

test("打开窗口引擎把无头模式传给 Edge，并保留统一店铺资料目录", async () => {
  let launchOptions = null;
  let cleanedCacheCount = 0;
  const result = await runManagedOpenWindowEngine({
    platformKey: "tmall",
    browserMode: "headless",
    storeConfig: {
      key: "tmall-test",
      displayName: "天猫测试店",
      username: "test-user",
      password: "test-pass",
      siteUrl: "https://qn.taobao.com/home.html/voc-tmall/serverReport"
    }
  }, {
    closeManagedChrome: async () => {},
    cleanStoreBrowserCaches: () => { cleanedCacheCount += 1; },
    launchChromeForManualLogin: async (_targetUrl, options) => { launchOptions = options; },
    logFn: () => {}
  });
  assert.equal(result.browserMode, "headless");
  assert.equal(result.headless, true);
  assert.equal(launchOptions.headless, true);
  assert.equal(launchOptions.browserMode, "headless");
  assert.equal(cleanedCacheCount, 1);
  assert.match(launchOptions.userDataDir, /store-chrome-profiles/);
});

test("混合模式只在人工介入时切换一次并重试同一业务动作", async () => {
  let actionCount = 0;
  const events = [];
  const result = await runHybridStoreCollection({
    platformKey: "jd",
    mode: "hybrid",
    openHeaded: async () => events.push("open-headed"),
    onProgress: (stage) => events.push(stage)
  }, async () => {
    actionCount += 1;
    if (actionCount === 1) requireHeadedBrowser("京东需要滑块验证");
    assert.equal(getAutomationScope().headless, false);
    return "collected";
  });
  assert.equal(result, "collected");
  assert.equal(actionCount, 2);
  assert.deepEqual(events, ["切换可见浏览器", "open-headed"]);
});

test("普通采集错误不自动重试", async () => {
  let actionCount = 0;
  let openedHeaded = 0;
  await assert.rejects(runHybridStoreCollection({
    platformKey: "jd",
    mode: "hybrid",
    openHeaded: async () => { openedHeaded += 1; }
  }, async () => {
    actionCount += 1;
    throw new Error("页面结构不匹配");
  }), /页面结构不匹配/);
  assert.equal(actionCount, 1);
  assert.equal(openedHeaded, 0);
});

test("纯无头模式遇到人工介入时明确失败且不开窗", async () => {
  let openedHeaded = 0;
  await assert.rejects(runHybridStoreCollection({
    platformKey: "jd",
    mode: "headless",
    openHeaded: async () => { openedHeaded += 1; }
  }, async () => requireHeadedBrowser("登录验证")), { code: "HEADLESS_REQUIRES_HUMAN" });
  assert.equal(openedHeaded, 0);
});

test("天猫无头模式遇到登录页立即交给混合层", async () => {
  const page = {
    url() { return "https://loginmyseller.taobao.com/"; },
    locator() {
      return { first() { return { isVisible: async () => false }; } };
    },
    getByText() {
      return { first() { return { isVisible: async () => false }; } };
    },
    frames() { return []; }
  };
  const browser = { contexts() { return [{ pages() { return [page]; } }]; } };
  await assert.rejects(
    runInAutomationScope(createScope({ platformKey: "tmall" }), () =>
      waitForTmallLoginReady(browser, { username: "", password: "" }, { headless: true, timeoutMs: 1000 })
    ),
    { code: "BROWSER_NEEDS_HUMAN" }
  );
});

test("拼多多无头模式遇到登录表单立即交给混合层", async () => {
  const page = {
    url() { return "https://mms.pinduoduo.com/login"; },
    locator() {
      return {
        innerText: async () => "手机号登录 立即登录",
        count: async () => 0
      };
    },
    frames() { return []; }
  };
  const browser = { contexts() { return [{ pages() { return [page]; } }]; } };
  await assert.rejects(
    runInAutomationScope(createScope({ platformKey: "pdd" }), () =>
      waitForPddLoginReady(browser, { username: "", password: "" }, { headless: true, timeoutMs: 1000 })
    ),
    { code: "BROWSER_NEEDS_HUMAN" }
  );
});

test("人工标记不会泄漏到下一次独立作用域", async () => {
  await assert.rejects(runInAutomationScope(createScope(), async () => {
    requireHeadedBrowser("验证码");
  }), { code: "BROWSER_NEEDS_HUMAN" });
  assert.equal(getAutomationScope(), undefined);
  await runInAutomationScope(createScope({ headless: false }), async () => {
    assert.equal(getAutomationScope().intervention, undefined);
  });
});

test("无头 Edge 关闭通过 Browser.close，而不是只断开客户端", async () => {
  const calls = [];
  const connect = async () => ({
    newBrowserCDPSession: async () => ({ send: async (command) => calls.push(command) }),
    close: async () => calls.push("disconnect")
  });
  assert.equal(await requestChromeCloseOverCDP("http://127.0.0.1:9334", { connect }), true);
  assert.deepEqual(calls, ["Browser.close", "disconnect"]);
});
