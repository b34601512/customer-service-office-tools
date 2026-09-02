const assert = require("assert");
const {
  resolveForceRedownloadSelection,
  showForceRedownloadMenu
} = require("../src/cli/cliForceRedownloadMenu");
const {
  selectConfiguredSummaryTasks,
  runConfiguredSummaryTask
} = require("../src/cli/cliSummaryTask");
const {
  runConfiguredSummaryWorkflow
} = require("../src/summary/configuredWorkflowParts/configuredSummaryRunner");

function buildConfiguredTasksForTest() {
  return [
    {
      id: "tmall-tmall1-all",
      platformKey: "tmall",
      platformLabel: "天猫",
      storeKey: "tmall1",
      storeDisplayName: "天猫1店",
      exportDateRangeText: "2026-08-01 至 2026-08-02",
      reportKeys: ["performance"]
    },
    {
      id: "pdd-pdd02-all",
      platformKey: "pdd",
      platformLabel: "拼多多",
      storeKey: "pdd02",
      storeDisplayName: "德达拼多多02",
      exportDateRangeText: "2026-08-01 至 2026-08-02",
      reportKeys: ["performance"]
    }
  ];
}

function testForceRedownloadSelectionSupportsSingleStoreAndAllStores() {
  const configuredTasks = buildConfiguredTasksForTest();
  assert.deepStrictEqual(
    resolveForceRedownloadSelection("2", configuredTasks).selectedSummaryTaskIds,
    ["pdd-pdd02-all"]
  );
  assert.deepStrictEqual(
    resolveForceRedownloadSelection("A", configuredTasks).selectedSummaryTaskIds,
    ["tmall-tmall1-all", "pdd-pdd02-all"]
  );
  assert.strictEqual(resolveForceRedownloadSelection("0", configuredTasks).kind, "back");
  assert.strictEqual(resolveForceRedownloadSelection("99", configuredTasks).kind, "invalid");
}

function testSelectedSummaryTaskFilterDoesNotAffectNormalAllStoreRun() {
  const configuredTasks = buildConfiguredTasksForTest();
  assert.deepStrictEqual(
    selectConfiguredSummaryTasks(configuredTasks, ["pdd-pdd02-all"]),
    [configuredTasks[1]]
  );
  assert.deepStrictEqual(selectConfiguredSummaryTasks(configuredTasks), configuredTasks);
}

async function testForceRedownloadMenuStartsOnlySelectedStore() {
  const configuredTasks = buildConfiguredTasksForTest();
  let receivedRunOptions = null;
  const outputLines = [];
  const terminal = {
    clear() {},
    writeLine(value = "") { outputLines.push(String(value)); },
    prompt: async () => "2",
    pause: async () => {},
    theme: { title: String, muted: String, error: String }
  };
  await showForceRedownloadMenu(terminal, {
    readProjectConfig: () => ({}),
    buildConfiguredSummaryTasks: () => configuredTasks,
    runConfiguredSummaryTask: async (runOptions) => {
      receivedRunOptions = runOptions;
      return { status: "success" };
    },
    runBatchTaskFromCli: async (batchOptions) => batchOptions.runTask()
  });
  assert.deepStrictEqual(receivedRunOptions, {
    selectedSummaryTaskIds: ["pdd-pdd02-all"],
    forceRedownload: true
  });
  assert.match(outputLines.join("\n"), /全部已启用店铺/);
}

async function testCliRunPassesSelectedScopeAndForceFlag() {
  const configuredTasks = buildConfiguredTasksForTest();
  let receivedWorkflowOptions = null;
  const result = await runConfiguredSummaryTask({
    readProjectConfig: () => ({ workbook: { path: "summary.xlsx" } }),
    buildConfiguredSummaryTasks: () => configuredTasks,
    selectedSummaryTaskIds: ["tmall-tmall1-all"],
    forceRedownload: true,
    nowFn: () => new Date("2026-08-04T05:00:00.000Z"),
    runConfiguredSummaryWorkflow: async (workflowOptions) => {
      receivedWorkflowOptions = workflowOptions;
      return { status: "success", detail: "完成", errorCount: 0 };
    }
  });
  assert.strictEqual(result.status, "success");
  assert.deepStrictEqual(receivedWorkflowOptions.tasks, [configuredTasks[0]]);
  assert.strictEqual(receivedWorkflowOptions.forceRedownload, true);
}

async function testWorkflowPassesForceFlagToStoreTask() {
  const [configuredTask] = buildConfiguredTasksForTest();
  let receivedStoreTaskInput = null;
  await runConfiguredSummaryWorkflow({
    projectConfig: { workbook: { path: "summary.xlsx" }, __projectRoot: process.cwd() },
    tasks: [configuredTask],
    dateRange: { startText: "2026-08-01", endText: "2026-08-02" },
    forceRedownload: true,
    // 本测试只验证force标志传递，跳过本轮重置（清空/清理）以免依赖真实汇总表。
    resetForToday: false,
    assertSummaryWorkbookWritable: async () => {},
    closeManagedChrome: async () => {},
    logFn() {},
    logErrorFn() {},
    runSingleSummaryTask: async (storeTaskInput) => {
      receivedStoreTaskInput = storeTaskInput;
      return { action: "完成", detail: "完成" };
    }
  });
  assert.strictEqual(receivedStoreTaskInput.forceRedownload, true);
  assert.strictEqual(receivedStoreTaskInput.task.id, "tmall-tmall1-all");
}

(async () => {
  testForceRedownloadSelectionSupportsSingleStoreAndAllStores();
  testSelectedSummaryTaskFilterDoesNotAffectNormalAllStoreRun();
  await testForceRedownloadMenuStartsOnlySelectedStore();
  await testCliRunPassesSelectedScopeAndForceFlag();
  await testWorkflowPassesForceFlagToStoreTask();
  console.log("PASS 首页可按单店或全部店铺强制重新下载并汇总");
})();
