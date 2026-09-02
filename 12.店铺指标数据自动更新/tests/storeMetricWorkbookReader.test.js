const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const XLSX = require("xlsx");
const {
  listStoreMetricRecordKeys,
  hasReusableStoreMetricData
} = require("../src/summaryData/storeMetricWorkbookReader");

const workbookPath = path.join(
  os.tmpdir(),
  `store-metric-workbook-reader-${process.pid}.xlsx`
);

function createReaderFixture() {
  const rows = [["平台", "店铺编号", "记录键"]];
  rows.push(...Array.from({ length: 13 }, (_, index) => [
    "天猫",
    "tmall1",
    `tmall-record-${index + 1}`
  ]));
  rows.push(...Array.from({ length: 14 }, (_, index) => [
    "抖音",
    "douyin3",
    `douyin-record-${index + 1}`
  ]));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "数据源"
  );
  XLSX.writeFile(workbook, workbookPath);
}

createReaderFixture();

test("工作簿完整性检查能读取指定平台和店铺的记录键", async () => {
  const recordKeys = await listStoreMetricRecordKeys({
    workbookPath,
    platformKey: "tmall",
    storeKey: "tmall1"
  });
  assert.equal(recordKeys.length, 13);
  assert.ok(recordKeys.every((recordKey) => recordKey.length > 0));
});

test("抖音平台名称映射正确，已完成店铺可以复用而不重复采集", async () => {
  const recordKeys = await listStoreMetricRecordKeys({
    workbookPath,
    platformKey: "douyin",
    storeKey: "douyin3"
  });
  assert.equal(recordKeys.length, 14);
  assert.equal(await hasReusableStoreMetricData({
    workbookPath,
    store: { platformKey: "douyin", key: "douyin3" },
    reusableRun: { metricCount: recordKeys.length, recordKeys }
  }), true);
});

test("历史记录带记录键时，缺少任一行就不能复用", async () => {
  const recordKeys = await listStoreMetricRecordKeys({
    workbookPath,
    platformKey: "tmall",
    storeKey: "tmall1"
  });
  assert.equal(await hasReusableStoreMetricData({
    workbookPath,
    store: { platformKey: "tmall", key: "tmall1" },
    reusableRun: { metricCount: recordKeys.length, recordKeys }
  }), true);
  assert.equal(await hasReusableStoreMetricData({
    workbookPath,
    store: { platformKey: "tmall", key: "tmall1" },
    reusableRun: { metricCount: recordKeys.length, recordKeys: recordKeys.slice(0, -1).concat("missing-record") }
  }), false);
});

test("汇总表没有该店铺记录时不能复用旧成功历史", async () => {
  assert.equal(await hasReusableStoreMetricData({
    workbookPath,
    store: { platformKey: "tmall", key: "tmall6" },
    reusableRun: { metricCount: 22, recordKeys: [] }
  }), false);
});
