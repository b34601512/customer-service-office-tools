const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createControlCenterStateStore } = require("../src/controlCenter/controlCenterState");
const { createJdStoreConfig } = require("../src/config/storeMetricConfig");
const { runConfiguredStoresTask } = require("../src/controlCenter/controlCenterTask");

test("店铺采集等待期间持续发布动作心跳", async () => {
  const workbookPath = path.join(
    __dirname,
    "..",
    "outputs",
    "019fbb96-c39c-7ec1-899b-038594c1381a",
    "店铺指标数据源.xlsx"
  );
  const store = createJdStoreConfig({
    key: "heartbeat-jd1",
    displayName: "心跳测试店",
    username: "user",
    password: "pass"
  });
  const stateStore = createControlCenterStateStore();
  const snapshots = [];
  stateStore.subscribe((state) => snapshots.push(state));

  await runConfiguredStoresTask(stateStore, {
    activityHeartbeatIntervalMs: 100,
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
    async collectStoreMetrics({ onProgress }) {
      onProgress({ stage: "读取页面指标", detail: "读取店铺指标" });
      await new Promise((resolve) => setTimeout(resolve, 350));
      return { metricCount: 1 };
    }
  });

  const heartbeatSnapshots = snapshots.filter((state) => /已运行/.test(state.detail));
  assert.ok(heartbeatSnapshots.length >= 2);
  assert.ok(heartbeatSnapshots.some((state) => /检查页面响应|校验页面结构|等待业务数据返回/.test(state.detail)));
  assert.equal(stateStore.read().status, "success");
});
