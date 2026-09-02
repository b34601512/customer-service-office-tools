const test = require("node:test");
const assert = require("node:assert/strict");
const { createStoreMetricRecord } = require("../src/metrics/storeMetricRecord");

function createInput(overrides = {}) {
  return {
    dataDate: "2026-07-31",
    statisticsStartDate: "2026-07-02",
    statisticsEndDate: "2026-07-31",
    platform: "京东",
    storeKey: "jd1",
    storeName: "京东1店",
    metricName: "平台介入率（店铺星级）",
    metricValue: 0.0022148,
    unit: "%",
    originalStatisticsWindow: "近30天",
    sourcePage: "店铺星级",
    sourceUrl: "https://example.test/shop-star",
    sourceOriginalMetricName: "平台介入率",
    collectedAt: "2026-08-01T07:00:00.000Z",
    ...overrides
  };
}

test("同口径重复记录生成同一记录键", () => {
  const firstRecord = createStoreMetricRecord(createInput());
  const secondRecord = createStoreMetricRecord(createInput({ collectedAt: "2026-08-01T08:00:00.000Z" }));
  assert.equal(firstRecord.metricName, "京东-平台介入率（店铺星级）");
  assert.equal("metricCategory" in firstRecord, false);
  assert.equal("unifiedMetricName" in firstRecord, false);
  assert.equal(firstRecord.recordKey, secondRecord.recordKey);
});

test("同名指标不同来源生成不同记录键", () => {
  const shopStarRecord = createStoreMetricRecord(createInput());
  const negativeServiceRecord = createStoreMetricRecord(createInput({
    metricName: "平台介入率（违规服务分析）",
    sourcePage: "违规服务分析-交易纠纷",
    sourceUrl: "https://example.test/negative-service"
  }));
  assert.notEqual(shopStarRecord.recordKey, negativeServiceRecord.recordKey);
});
