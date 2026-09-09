const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createControlCenterStateStore } = require("../src/controlCenter/controlCenterState");
const { createJdStoreConfig } = require("../src/config/storeMetricConfig");
const { runConfiguredStoresTask } = require("../src/controlCenter/controlCenterTask");

test("店铺采集返回无数据指标时仍完成，并在结果中标记记0", async () => {
  const workbookPath = path.join(
    __dirname,
    "..",
    "outputs",
    "019fbb96-c39c-7ec1-899b-038594c1381a",
    "店铺指标数据源.xlsx"
  );
  const store = createJdStoreConfig({
    key: "zero-data-jd1",
    displayName: "无数据测试店",
    username: "user",
    password: "pass"
  });
  const stateStore = createControlCenterStateStore();
  const result = await runConfiguredStoresTask(stateStore, {
    readConfig() {
      return {
        workbook: { path: workbookPath },
        dateSelection: { mode: "automatic" },
        jd: { stores: [store] }
      };
    },
    findSuccessfulRun() { return null; },
    assertWorkbookWritable() {},
    appendSuccessfulRun() {},
    async collectStoreMetrics() {
      return { metricCount: 3, zeroDataMetrics: ["咚咚平均响应时长", "售后评价得分"] };
    }
  });

  assert.equal(result.successCount, 1);
  assert.equal(result.errorCount, 0);
  assert.equal(result.stores[0].zeroDataCount, 2);
  assert.match(result.stores[0].detail, /2 项无数据记0/);
});
