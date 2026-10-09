const assert = require("assert");
const { createDefaultProjectConfig } = require("../src/config/projectConfigDefaults");
const { createManualExportDateRangeConfig } = require("../src/shared/exportDateRange");
const { buildConfiguredSummaryTasks, mergeConfiguredSummaryTasks } = require("../src/controlCenter/summaryTaskPlanner");
const {
  formatCliBrandMetadata,
  resolveSummaryDateRangeOverview,
  resolveSummaryRunOutcome,
  renderDashboard
} = require("../src/cli/cliDashboard");

function createSingleStoreProjectConfig() {
  const projectConfig = createDefaultProjectConfig(new Date(2026, 7, 1));
  const store = projectConfig.tmall.stores[0];
  store.usesGlobalExportDateRange = false;
  store.exportDateRange = createManualExportDateRangeConfig("2026-06-15", "2026-07-14");
  projectConfig.tmall.stores = [store]; projectConfig.jd.stores = []; projectConfig.pdd.stores = []; projectConfig.douyin.stores = [];
  return projectConfig;
}

function testTaskDateRangeComesFromCurrentStoreConfig() {
  const configuredTasks = buildConfiguredSummaryTasks(createSingleStoreProjectConfig());
  assert.strictEqual(configuredTasks.length, 1);
  assert.strictEqual(configuredTasks[0].exportDateRangeText, "2026-06-15 至 2026-07-14");
  assert.strictEqual(configuredTasks[0].usesGlobalExportDateRange, false);
  const mergedTasks = mergeConfiguredSummaryTasks(configuredTasks, [{ id: configuredTasks[0].id, status: "running", exportDateRangeText: "过期日期" }]);
  assert.strictEqual(mergedTasks[0].status, "running");
  assert.strictEqual(mergedTasks[0].exportDateRangeText, "2026-06-15 至 2026-07-14");
}

function testCliOverviewDistinguishesCustomStoreRanges() {
  assert.deepStrictEqual(resolveSummaryDateRangeOverview([
    { exportDateRangeText: "2026-07-01 至 2026-07-30", usesGlobalExportDateRange: true },
    { exportDateRangeText: "2026-07-01 至 2026-07-30", usesGlobalExportDateRange: true }
  ]), { text: "当前下载统计范围：2026-07-01 至 2026-07-30", hasDifferentStoreRanges: false });
  assert.deepStrictEqual(resolveSummaryDateRangeOverview([
    { exportDateRangeText: "2026-07-01 至 2026-07-30", usesGlobalExportDateRange: true },
    { exportDateRangeText: "2026-06-15 至 2026-07-14", usesGlobalExportDateRange: false }
  ]), { text: "当前下载统计范围：存在 2 组日期，1 家为单店自定义；详见各店铺。", hasDifferentStoreRanges: true });
}

function testCliShowsPersistentFinishedRunOutcome() {
  const finishedAt = new Date(2026, 7, 1, 16, 8, 31);
  assert.deepStrictEqual(resolveSummaryRunOutcome({ summaryRunFinishedAt: finishedAt.toISOString() }, Array.from({ length: 3 }, () => ({ status: "success" }))), {
    kind: "success", title: "🎉 本次汇总圆满完成！", detail: "共 3 家店铺全部成功，数据已写入汇总表。",
    finishedAtIso: finishedAt.toISOString(), finishedAtText: "2026-08-01 16:08:31"
  });
  assert.deepStrictEqual(resolveSummaryRunOutcome({ summaryRunFinishedAt: finishedAt.toISOString() }, [
    ...Array.from({ length: 10 }, () => ({ status: "success" })), ...Array.from({ length: 2 }, () => ({ status: "error" }))
  ]), {
    kind: "error", title: "⚠️ 本次汇总存在失败", detail: "共 12 家店铺：成功 10 家，失败 2 家；请查看失败店铺的红色行和凭证。",
    finishedAtIso: finishedAt.toISOString(), finishedAtText: "2026-08-01 16:08:31"
  });
  assert.strictEqual(resolveSummaryRunOutcome({ summaryRunFinishedAt: "" }, [{ status: "success" }]), null);
  assert.strictEqual(resolveSummaryRunOutcome({ summaryRunFinishedAt: "2026-08-01T08:00:00.000Z" }, [{ status: "success" }, { status: "running" }]), null);
}

function testCliRendersFinishedRunOutcome() {
  const projectConfig = createSingleStoreProjectConfig();
  const finishedTasks = buildConfiguredSummaryTasks(projectConfig).map((task) => ({ ...task, status: "success" }));
  const outputLines = [];
  const terminal = { clear() {}, writeLine(value = "") { outputLines.push(String(value)); }, theme: { title: String, muted: String, heading: String } };
  renderDashboard({ terminal, projectConfig, state: { summaryRunFinishedAt: "2026-08-01T08:00:00.000Z", summaryTasks: finishedTasks } });
  const outputText = outputLines.join("\n");
  assert.match(outputText, /客服数据自动更新/);
  assert.match(outputText, /作者：黎路遥/);
  assert.match(outputText, /微信：luyao2089/);
  assert.match(outputText, /官网：https:\/\/luyao2089\.cc/);
  assert.match(outputText, /共 1 家店铺全部成功/);
  assert.match(outputText, /平台\/店铺管理/);
  assert.match(outputText, /强制重新下载/);
}

function testCliBrandMetadataIsComplete() {
  assert.strictEqual(
    formatCliBrandMetadata(),
    "作者：黎路遥    微信：luyao2089    官网：https://luyao2089.cc"
  );
}

testTaskDateRangeComesFromCurrentStoreConfig();
testCliOverviewDistinguishesCustomStoreRanges();
testCliShowsPersistentFinishedRunOutcome();
testCliRendersFinishedRunOutcome();
testCliBrandMetadataIsComplete();
console.log("PASS CLI首页应显示总体下载日期和常驻整轮汇总结果");
