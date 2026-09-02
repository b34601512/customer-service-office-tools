const assert = require("assert");
const {
  createManualExportDateRangeConfig,
  resolveAutomatedExportDateRange,
  resolveDefaultCompletedExportDateRange,
  validateExportDateMode,
  validateExportDateAutomationConfig
} = require("../src/shared/exportDateRange");
const {
  resolveDefaultSummaryDateRange
} = require("../src/summary/summaryDateRange");
const {
  refreshDefaultCompletedExportDateRange,
  synchronizeGlobalExportDateRangeForSave
} = require("../src/config/projectConfigServiceParts/projectConfigGlobalDateSync");

function assertDefaultDateRange(baseDate, expectedStartText, expectedEndText) {
  const exportDateRange = resolveDefaultCompletedExportDateRange(baseDate);
  const summaryDateRange = resolveDefaultSummaryDateRange(baseDate);

  assert.strictEqual(exportDateRange.startText, expectedStartText);
  assert.strictEqual(exportDateRange.endText, expectedEndText);
  assert.strictEqual(summaryDateRange.startText, expectedStartText);
  assert.strictEqual(summaryDateRange.endText, expectedEndText);
}

function createStoreDateState(startText, endText, usesGlobalExportDateRange) {
  return {
    usesGlobalExportDateRange,
    exportDateRange: createManualExportDateRangeConfig(startText, endText)
  };
}

function readStoreDateTexts(store) {
  return [
    store.exportDateRange.start.customDate,
    store.exportDateRange.end.customDate
  ];
}

function testCustomAutomationParameters() {
  // 智能模式起始固定为月初；旧配置遗留的 dateRangeDayCount 应被忽略兼容。
  const dateRange = resolveAutomatedExportDateRange({
    dateRangeDayCount: 7,
    endDateDelayDayCount: 3
  }, new Date(2026, 7, 1));
  assert.strictEqual(dateRange.startText, "2026-07-01");
  assert.strictEqual(dateRange.endText, "2026-07-29");
  const simplifiedRange = resolveAutomatedExportDateRange({ endDateDelayDayCount: 3 }, new Date(2026, 7, 1));
  assert.strictEqual(simplifiedRange.startText, "2026-07-01");
  assert.strictEqual(simplifiedRange.endText, "2026-07-29");
  assert.throws(
    () => validateExportDateAutomationConfig({ endDateDelayDayCount: -1 }),
    /结束日期延迟天数必须是/
  );
  assert.throws(() => validateExportDateMode("unknown"), /下载日期模式不支持/);
}

function testLastSavedDateScopeWins() {
  const projectConfig = {
    globalDefaults: {
      exportDateMode: "automatic",
      exportDateAutomation: {
        dateRangeDayCount: 30,
        endDateDelayDayCount: 2
      },
      exportDateRange: createManualExportDateRangeConfig("2026-06-01", "2026-06-30")
    },
    tmall: {
      stores: [
        createStoreDateState("2026-06-01", "2026-06-30", true),
        createStoreDateState("2026-05-05", "2026-05-12", false)
      ]
    },
    jd: { stores: [] },
    pdd: { stores: [] },
    douyin: { stores: [] }
  };

  refreshDefaultCompletedExportDateRange(projectConfig, new Date(2026, 7, 1));
  assert.deepStrictEqual(readStoreDateTexts(projectConfig.tmall.stores[0]), ["2026-07-01", "2026-07-30"]);
  assert.deepStrictEqual(readStoreDateTexts(projectConfig.tmall.stores[1]), ["2026-05-05", "2026-05-12"]);
  assert.strictEqual(projectConfig.tmall.stores[1].usesGlobalExportDateRange, false);

  projectConfig.globalDefaults.exportDateRange = createManualExportDateRangeConfig("2026-06-10", "2026-06-20");
  synchronizeGlobalExportDateRangeForSave(projectConfig, "manual", new Date(2026, 7, 1));
  assert.strictEqual(projectConfig.globalDefaults.exportDateMode, "manual");
  projectConfig.tmall.stores.forEach((store) => {
    assert.deepStrictEqual(readStoreDateTexts(store), ["2026-06-10", "2026-06-20"]);
    assert.strictEqual(store.usesGlobalExportDateRange, true);
  });
  assert.strictEqual(refreshDefaultCompletedExportDateRange(projectConfig, new Date(2026, 7, 2)), false);
  assert.deepStrictEqual(readStoreDateTexts(projectConfig.tmall.stores[0]), ["2026-06-10", "2026-06-20"]);

  projectConfig.globalDefaults.exportDateAutomation = {
    dateRangeDayCount: 7,
    endDateDelayDayCount: 3
  };
  synchronizeGlobalExportDateRangeForSave(projectConfig, "automatic", new Date(2026, 7, 1));
  assert.strictEqual(projectConfig.globalDefaults.exportDateMode, "automatic");
  projectConfig.tmall.stores.forEach((store) => {
    assert.deepStrictEqual(readStoreDateTexts(store), ["2026-07-01", "2026-07-29"]);
    assert.strictEqual(store.usesGlobalExportDateRange, true);
  });
}

function run() {
  assertDefaultDateRange(new Date(2026, 7, 1), "2026-07-01", "2026-07-30");
  assertDefaultDateRange(new Date(2026, 7, 2), "2026-07-01", "2026-07-31");
  assertDefaultDateRange(new Date(2026, 7, 3), "2026-08-01", "2026-08-01");
  assertDefaultDateRange(new Date(2026, 0, 1), "2025-12-01", "2025-12-30");
  assertDefaultDateRange(new Date(2024, 2, 1), "2024-02-01", "2024-02-28");
  testCustomAutomationParameters();
  testLastSavedDateScopeWins();
  console.log("PASS 智能模式本月1号起、2天延迟、单店保留及全店重新覆盖均符合规则");
}

run();
