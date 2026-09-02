const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJdStoreConfig } = require("../src/config/storeMetricConfig");
const {
  appendSuccessfulStoreMetricRun,
  findSuccessfulStoreMetricRun
} = require("../src/shared/taskHistoryParts/storeMetricRunHistory");

test("只复用同店同日同口径的成功采集记录", () => {
  process.env.STORE_METRIC_TASK_HISTORY_PATH = path.join(
    __dirname,
    "..",
    ".codex-temporary",
    "test-history",
    `store-metric-run-${process.pid}-${Date.now()}.json`
  );
  const store = createJdStoreConfig({
    key: "jd2",
    displayName: "京东2店",
    username: "two",
    password: "two-pass"
  });
  const automaticDateSelection = { mode: "automatic", snapshotDate: "" };
  const workbookPath = "D:\\测试\\店铺指标.xlsx";
  appendSuccessfulStoreMetricRun({
    store,
    dateSelection: automaticDateSelection,
    workbookPath,
    metricCount: 37,
    recordKeys: ["record-a", "record-a", "record-b"],
    now: new Date("2026-08-01T09:00:00+08:00")
  });
  const successfulRun = findSuccessfulStoreMetricRun({
    store,
    dateSelection: automaticDateSelection,
    workbookPath,
    now: new Date("2026-08-01T18:00:00+08:00")
  });
  assert.equal(successfulRun.metricCount, 37);
  assert.deepEqual(successfulRun.recordKeys, ["record-a", "record-b"]);
  assert.equal(findSuccessfulStoreMetricRun({
    store,
    dateSelection: automaticDateSelection,
    workbookPath,
    now: new Date("2026-08-02T00:01:00+08:00")
  }), null);
  assert.equal(findSuccessfulStoreMetricRun({
    store,
    dateSelection: { mode: "manual", snapshotDate: "2026-07-31" },
    workbookPath,
    now: new Date("2026-08-01T18:00:00+08:00")
  }), null);
  delete process.env.STORE_METRIC_TASK_HISTORY_PATH;
});
