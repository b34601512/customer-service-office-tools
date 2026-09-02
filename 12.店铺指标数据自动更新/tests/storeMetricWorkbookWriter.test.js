const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");
const { createStoreMetricRecord } = require("../src/metrics/storeMetricRecord");
const { writeStoreMetricRecords } = require("../src/summaryData/storeMetricWorkbookWriter");

const projectRoot = path.resolve(__dirname, "..");
const templatePath = path.join(
  projectRoot,
  "outputs",
  "019fbb96-c39c-7ec1-899b-038594c1381a",
  "店铺指标数据源.xlsx"
);

function createSampleRecord(metricValue, collectedAt, overrides = {}) {
  return createStoreMetricRecord({
    dataDate: "2026-07-31",
    statisticsStartDate: "2026-07-01",
    statisticsEndDate: "2026-07-25",
    platform: "京东",
    storeKey: "test-jd1",
    storeName: "测试京东店",
    metricName: "延迟发货率",
    metricValue,
    unit: "%",
    originalStatisticsWindow: "页面统计区间：2026-07-01至2026-07-25",
    sourcePage: "违规服务分析-物流履约",
    sourceUrl: "https://example.test/negative-service",
    sourceOriginalMetricName: "延迟发货率",
    collectedAt,
    ...overrides
  });
}

test("统一数据源按店铺覆盖旧数据，不重复保留旧指标", async () => {
  const testDirectory = path.join(projectRoot, ".codex-temporary", "test-output");
  fs.mkdirSync(testDirectory, { recursive: true });
  const workbookPath = path.join(testDirectory, `store-metric-writer-${process.pid}.xlsx`);
  const templateWorkbook = XLSX.readFile(templatePath, { cellDates: true });
  const templateRows = XLSX.utils.sheet_to_json(templateWorkbook.Sheets["数据源"], { defval: "" });
  fs.copyFileSync(templatePath, workbookPath);
  await writeStoreMetricRecords({
    workbookPath,
    records: [createSampleRecord(0.0014, "2026-08-01T07:00:00.000Z")]
  });
  await writeStoreMetricRecords({
    workbookPath,
    records: [createSampleRecord(0.0015, "2026-08-01T08:00:00.000Z", {
      metricName: "新的指标",
      sourceOriginalMetricName: "新的指标"
    })]
  });
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["数据源"], { defval: "" });
  const testRows = rows.filter((row) => row["店铺编号"] === "test-jd1");
  assert.equal(rows.length, templateRows.length + 1);
  assert.equal(testRows.length, 1);
  assert.ok(Math.abs(Number(testRows[0]["指标数值"]) - 0.0015) < 1e-12);
  assert.equal(testRows[0]["指标名称"], "京东-新的指标");
});

test("统一数据源会清理已经退役的客服来源", async () => {
  const testDirectory = path.join(projectRoot, ".codex-temporary", "test-output");
  fs.mkdirSync(testDirectory, { recursive: true });
  const workbookPath = path.join(testDirectory, `store-metric-retired-${process.pid}.xlsx`);
  fs.copyFileSync(templatePath, workbookPath);
  await writeStoreMetricRecords({
    workbookPath,
    records: [createSampleRecord(0.8, "2026-08-01T07:00:00.000Z", {
      metricName: "咨询满意率",
      sourcePage: "京麦-接待数据",
      sourceOriginalMetricName: "好评量/评价量"
    })]
  });
  const result = await writeStoreMetricRecords({
    workbookPath,
    records: [createSampleRecord(0.0014, "2026-08-01T08:00:00.000Z")],
    retiredSourcePages: ["京麦-接待数据"]
  });
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["数据源"], { defval: "" });
  assert.equal(rows.filter((row) => row["来源页面"] === "京麦-接待数据").length, 0);
  assert.ok(result.removedCount >= 1);
});
