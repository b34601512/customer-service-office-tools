const test = require("node:test");
const assert = require("node:assert/strict");
const { createCliTheme } = require("../src/cli/cliTheme");
const { renderDashboard } = require("../src/cli/cliDashboard");
const { createControlCenterStateStore } = require("../src/controlCenter/controlCenterState");
const { startCliRuntime } = require("../src/cli/cliRuntime");
const { showForceCollectionScopeMenu } = require("../src/cli/cliCollectionScopeMenu");

function createCaptureTerminal(answers = []) {
  const output = { isTTY: false };
  const lines = [];
  return {
    lines,
    theme: createCliTheme(output),
    clear() {},
    write() {},
    writeLine(text = "") { lines.push(String(text)); },
    async prompt() { return answers.shift() || "0"; },
    async promptText() { return answers.shift() || ""; },
    async promptSecret() { return answers.shift() || ""; },
    async pause() {}
  };
}

test("CLI首页展示版本、启用店铺、今日完成和最近结果", () => {
  const terminal = createCaptureTerminal();
  const config = {
    workbook: { path: "D:\\data\\店铺指标数据源.xlsx" },
    dateSelection: { mode: "automatic", manual: { snapshotDate: "2026-08-01" } },
    jd: { stores: [
      { key: "jd1", displayName: "京东1店", enabled: true },
      { key: "jd2", displayName: "京东2店", enabled: false }
    ] },
    tmall: { stores: [
      { platformKey: "tmall", key: "tmall1", displayName: "天猫1店", enabled: true }
    ] }
  };
  renderDashboard({
    terminal,
    config,
    state: createControlCenterStateStore().read(),
    taskHistory: { storeMetricRuns: [{
      platformKey: "jd",
      storeKey: "jd1",
      storeDisplayName: "京东1店",
      metricCount: 38,
      runDate: "2026-08-01",
      dateMode: "automatic",
      snapshotDate: "",
      sourceSignature: "||",
      workbookPath: "D:\\data\\店铺指标数据源.xlsx"
    }] },
    now: new Date("2026-08-01T12:00:00+08:00")
  });
  const outputText = terminal.lines.join("\n");
  assert.match(outputText, /v0\.01/);
  assert.match(outputText, /启用店铺  2 家/);
  assert.match(outputText, /今日完成  1\/2 家/);
  assert.match(outputText, /已完成\s+京东1店/);
  assert.match(outputText, /未完成\s+天猫1店/);
  assert.match(outputText, /平台分布  京东 1 家\s+天猫 1 家/);
  assert.match(outputText, /京东1店 · 38 项/);
});

test("CLI输入0后安全退出且不经过网页服务器", async () => {
  const terminal = createCaptureTerminal(["0"]);
  let initializeCount = 0;
  let closeBrowserCount = 0;
  await startCliRuntime({
    terminal,
    initializeLayout() { initializeCount += 1; },
    readConfig() {
      return {
        workbook: { path: "D:\\data\\店铺指标数据源.xlsx" },
        dateSelection: { mode: "automatic", manual: { snapshotDate: "2026-08-01" } },
        jd: { stores: [] }
      };
    },
    readHistory() { return { storeMetricRuns: [] }; },
    async closeBrowser() { closeBrowserCount += 1; }
  });
  assert.equal(initializeCount, 1);
  assert.equal(closeBrowserCount, 1);
  assert.match(terminal.lines.join("\n"), /控制台已退出/);
});

test("强制采集菜单支持按平台或单店选择范围", async () => {
  const config = {
    jd: { stores: [{ platformKey: "jd", key: "jd1", displayName: "京东1店", enabled: true }] },
    tmall: { stores: [{ platformKey: "tmall", key: "tmall1", displayName: "天猫1店", enabled: true }] },
    pdd: { stores: [{ platformKey: "pdd", key: "pdd1", displayName: "拼多多1店", enabled: true }] }
  };
  const platformTerminal = createCaptureTerminal(["2", "3"]);
  const platformScope = await showForceCollectionScopeMenu(platformTerminal, config);
  assert.deepEqual(platformScope, { type: "platform", platformKey: "pdd" });

  const storeTerminal = createCaptureTerminal(["3", "2"]);
  const storeScope = await showForceCollectionScopeMenu(storeTerminal, config);
  assert.deepEqual(storeScope, { type: "store", platformKey: "tmall", storeKey: "tmall1" });
});
