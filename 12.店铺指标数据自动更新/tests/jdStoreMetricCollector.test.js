const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const appConfig = require("../src/config/appConfig");
const { getAutomationScope } = require("../src/engine/browserAutomationScope");
const { runManagedOpenWindowEngine } = require("../src/shared/managedOpenWindowEngine");

// 替换外部I/O，实际执行京东入口、作用域、开窗计划与账号目录解析，不启动真实浏览器或写表。
function loadCollectorFixture({ loginError } = {}) {
  const events = [];
  let writtenRecords = null;
  const page = () => ({ screenshot: async () => {}, close: async () => {} });
  const collectPage = async () => {
    assert.equal(getAutomationScope().headless, false);
    return { records: [{ recordKey: "fixture-key", metricValue: 0 }], zeroDataMetrics: ["测试无数据"] };
  };
  const stubs = {
    fs: { existsSync: () => false },
    "../../../shared/managedOpenWindowEngine": {
      runManagedOpenWindowEngine: (options) => runManagedOpenWindowEngine(options, {
        closeManagedChrome: async () => events.push({ type: "close-before" }),
        launchChromeForManualLogin: async (url, options) => events.push({ type: "launch", url, options }),
        logFn: () => {}
      })
    },
    "../../../shared/evidenceFiles": {
      createStoreMetricEvidenceDirectory: () => "fixture-evidence",
      buildEvidenceFilePath: () => "fixture-screenshot.png",
      mergeEvidenceFiles: (...lists) => lists.flat().filter(Boolean),
      listExistingEvidenceFiles: (files = []) => files
    },
    "../jdLoginAssist": {
      startJdLoginAssist: async (options) => {
        events.push({ type: "login", headless: options.headless });
        assert.equal(getAutomationScope().headless, false);
        if (loginError) throw loginError;
        options.onLoginReady({ displayName: options.resolvedConfig.activeStore.displayName });
      }
    },
    "../../../engine/chromeSession": {
      connectToChrome: async () => ({ contexts: () => [{ newPage: async () => page() }] }),
      disconnectFromChrome: async () => {},
      closeManagedChrome: async () => events.push({ type: "close-after" })
    },
    "./jdShopStarMetricCollector": { collectJdShopStarMetrics: collectPage },
    "./jdNegativeServiceMetricCollector": { collectJdNegativeServiceMetrics: collectPage },
    "./jdComplianceMetricCollector": { collectJdComplianceMetrics: collectPage },
    "../../../summaryData/storeMetricWorkbookWriter": {
      writeStoreMetricRecords: async ({ records }) => {
        writtenRecords = records;
        return { writtenCount: records.length, replacedCount: 0, removedCount: 0 };
      }
    },
    "../../storeMetricsShared": {
      notifyProgress: () => {},
      captureFailurePageEvidence: async () => []
    }
  };
  const filename = require.resolve("../src/platforms/jd/storeMetrics/jdStoreMetricCollector");
  const localRequire = createRequire(filename);
  const fixtureModule = { exports: {} };
  const compile = vm.runInThisContext(`(function(require, module) {\n${fs.readFileSync(filename, "utf8")}\n})`, { filename });
  compile((name) => stubs[name] || localRequire(name), fixtureModule);
  return { ...fixtureModule.exports, events, getWrittenRecords: () => writtenRecords };
}

function createInput(key) {
  return {
    config: { workbook: { path: "fixture.xlsx" } },
    store: {
      platformKey: "jd", key, displayName: key,
      username: "test-user", password: "test-password",
      sources: { shopStar: "https://jdsz.jd.com/szweb/view/service/shop-experience-score.html" }
    },
    dateSelection: { mode: "automatic", snapshotDate: "" }
  };
}

for (const key of ["jd1", "jd3"]) {
  test(`${key}即使全局无头也仅启动一次可见Chrome，使用原账号目录并保留写0`, async (t) => {
    const previousMode = process.env.CUSTOMER_PERFORMANCE_BROWSER_MODE;
    process.env.CUSTOMER_PERFORMANCE_BROWSER_MODE = "headless";
    t.after(() => {
      if (previousMode === undefined) delete process.env.CUSTOMER_PERFORMANCE_BROWSER_MODE;
      else process.env.CUSTOMER_PERFORMANCE_BROWSER_MODE = previousMode;
    });
    const fixture = loadCollectorFixture();
    const result = await fixture.collectAndWriteJdStoreMetrics(createInput(key));
    const launches = fixture.events.filter((event) => event.type === "launch");
    assert.equal(launches.length, 1);
    assert.equal(launches[0].options.headless, false);
    assert.equal(launches[0].options.browserMode, "headed");
    assert.equal(launches[0].options.userDataDir, path.join(
      appConfig.runtime.state.browserProfilesRoot, "store-chrome-profiles", "jd", key,
      appConfig.getStoreAccountChromeProfileKey("jd", key, "test-user")
    ));
    assert.deepEqual(fixture.events.filter((event) => event.type === "login"), [{ type: "login", headless: false }]);
    assert.equal(result.metricCount, 3);
    assert.equal(fixture.getWrittenRecords().length, 3);
    assert.ok(fixture.getWrittenRecords().every((record) => record.metricValue === 0));
    assert.equal(fixture.events.filter((event) => event.type === "close-after").length, 1);
    assert.equal(getAutomationScope(), undefined);
  });
}

test("京东恢复旧目录不改变其他平台资料路径，且两店仍严格隔离", () => {
  for (const platform of ["tmall", "pdd", "douyin"]) {
    assert.equal(appConfig.getStoreAccountChromeUserDataDir(platform, "fixture", "test-user"), path.join(
      appConfig.runtime.state.browserProfilesRoot, "google-chrome-profiles", platform, "fixture",
      appConfig.getStoreAccountChromeProfileKey(platform, "fixture", "test-user")
    ));
  }
  assert.notEqual(
    appConfig.getStoreAccountChromeUserDataDir("jd", "jd1", "test-user"),
    appConfig.getStoreAccountChromeUserDataDir("jd", "jd3", "test-user")
  );
});

test("京东会话失败不重启整店、不写表", async () => {
  const fixture = loadCollectorFixture({ loginError: new Error("京东接口601，操作频繁") });
  await assert.rejects(fixture.collectAndWriteJdStoreMetrics(createInput("jd3")), /601/);
  assert.equal(fixture.events.filter((event) => event.type === "launch").length, 1);
  assert.equal(fixture.events.filter((event) => event.type === "login").length, 1);
  assert.equal(fixture.getWrittenRecords(), null);
  assert.equal(fixture.events.filter((event) => event.type === "close-after").length, 1);
});
