const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createControlCenterStateStore } = require("../src/controlCenter/controlCenterState");
const { createJdStoreConfig } = require("../src/config/storeMetricConfig");
const { runConfiguredStoresTask } = require("../src/controlCenter/controlCenterTask");

test("多店批量汇总逐店执行，单店失败后继续下一店", async () => {
  const workbookPath = path.join(
    __dirname,
    "..",
    "outputs",
    "019fbb96-c39c-7ec1-899b-038594c1381a",
    "店铺指标数据源.xlsx"
  );
  const stores = [
    createJdStoreConfig({ key: "jd1", displayName: "京东1店", username: "one", password: "one-pass" }),
    createJdStoreConfig({ key: "jd2", displayName: "京东2店", username: "two", password: "two-pass" }),
    createJdStoreConfig({ key: "jd3", displayName: "京东3店", username: "three", password: "three-pass" }),
    createJdStoreConfig({ key: "jd4", displayName: "京东4店", username: "four", password: "four-pass", enabled: false })
  ];
  const calledStoreKeys = [];
  const appendedStoreKeys = [];
  const stateStore = createControlCenterStateStore();
  const result = await runConfiguredStoresTask(stateStore, {
    readConfig() {
      return {
        workbook: { path: workbookPath },
        dateSelection: { mode: "automatic", manual: { snapshotDate: "2026-07-31" } },
        jd: { stores }
      };
    },
    async collectStoreMetrics({ store, onProgress }) {
      calledStoreKeys.push(store.key);
      onProgress({ stage: "读取页面指标", detail: store.displayName });
      if (store.key === "jd2") throw new Error("模拟京东2店页面失败");
      return { metricCount: 38 };
    },
    findSuccessfulRun() { return null; },
    assertWorkbookWritable() {},
    ensureStoreFailureEvidence() { return []; },
    appendSuccessfulRun({ store }) { appendedStoreKeys.push(store.key); }
  });
  assert.deepEqual(calledStoreKeys, ["jd1", "jd2", "jd3"]);
  assert.equal(result.successCount, 2);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.errorCount, 1);
  assert.equal(result.metricCount, 76);
  assert.equal(stateStore.read().status, "partial_error");
  assert.equal(result.stores.find((store) => store.storeKey === "jd2").status, "error");
  assert.equal(result.stores.find((store) => store.storeKey === "jd3").status, "success");
  assert.deepEqual(appendedStoreKeys, ["jd1", "jd3"]);
});

test("同店同日成功记录直接跳过，不启动该店采集", async () => {
  const workbookPath = path.join(__dirname, "..", "outputs", "019fbb96-c39c-7ec1-899b-038594c1381a", "店铺指标数据源.xlsx");
  const stores = [
    createJdStoreConfig({ key: "jd1", displayName: "京东1店", username: "one", password: "one-pass" }),
    createJdStoreConfig({ key: "jd2", displayName: "京东2店", username: "two", password: "two-pass" })
  ];
  const calledStoreKeys = [];
  const stateStore = createControlCenterStateStore();
  const result = await runConfiguredStoresTask(stateStore, {
    readConfig() {
      return {
        workbook: { path: workbookPath },
        dateSelection: { mode: "automatic", manual: { snapshotDate: "2026-07-31" } },
        jd: { stores }
      };
    },
    findSuccessfulRun({ store }) {
      return store.key === "jd1" ? { metricCount: 38 } : null;
    },
    assertWorkbookWritable() {},
    appendSuccessfulRun() {},
    async collectStoreMetrics({ store }) {
      calledStoreKeys.push(store.key);
      return { metricCount: 37 };
    },
    nowFn() { return new Date("2026-08-01T10:00:00+08:00"); }
  });
  assert.deepEqual(calledStoreKeys, ["jd2"]);
  assert.equal(result.successCount, 2);
  assert.equal(result.collectedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.metricCount, 37);
  assert.equal(result.stores.find((store) => store.storeKey === "jd1").status, "skipped");
  assert.match(result.stores.find((store) => store.storeKey === "jd1").detail, /不登录、不读取、不重复写入/);
});

test("历史成功但汇总表数据被删时重新采集，不再误跳过", async () => {
  const workbookPath = path.join(__dirname, "..", "outputs", "019fbb96-c39c-7ec1-899b-038594c1381a", "店铺指标数据源.xlsx");
  const store = createJdStoreConfig({ key: "jd1", displayName: "京东1店", username: "one", password: "one-pass" });
  const calledStoreKeys = [];
  const stateStore = createControlCenterStateStore();
  const result = await runConfiguredStoresTask(stateStore, {
    readConfig() {
      return {
        workbook: { path: workbookPath },
        dateSelection: { mode: "automatic", manual: { snapshotDate: "2026-07-31" } },
        jd: { stores: [store] }
      };
    },
    findSuccessfulRun() { return { metricCount: 38, recordKeys: ["old-record"] }; },
    hasReusableStoreMetricData() { return false; },
    assertWorkbookWritable() {},
    appendSuccessfulRun() {},
    async collectStoreMetrics() {
      calledStoreKeys.push(store.key);
      return { metricCount: 38, recordKeys: ["new-record"] };
    }
  });
  assert.deepEqual(calledStoreKeys, ["jd1"]);
  assert.equal(result.collectedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.match(result.stores[0].detail, /已写入 38 条/);
});

test("强制重新采集绕过今日成功历史并交给写入层按记录键覆盖", async () => {
  const workbookPath = path.join(__dirname, "..", "outputs", "019fbb96-c39c-7ec1-899b-038594c1381a", "店铺指标数据源.xlsx");
  const store = createJdStoreConfig({ key: "jd1", displayName: "京东1店", username: "one", password: "one-pass" });
  const calledStoreKeys = [];
  const stateStore = createControlCenterStateStore();
  const result = await runConfiguredStoresTask(stateStore, {
    readConfig() {
      return {
        workbook: { path: workbookPath },
        dateSelection: { mode: "automatic", manual: { snapshotDate: "2026-07-31" } },
        jd: { stores: [store] }
      };
    },
    forceRecollect: true,
    findSuccessfulRun() { return { metricCount: 38, recordKeys: ["old-record"] }; },
    hasReusableStoreMetricData() { throw new Error("强制采集不应读取复用判断"); },
    assertWorkbookWritable() {},
    appendSuccessfulRun() {},
    async collectStoreMetrics() {
      calledStoreKeys.push(store.key);
      return { metricCount: 38, recordKeys: ["new-record"] };
    }
  });
  assert.deepEqual(calledStoreKeys, ["jd1"]);
  assert.equal(result.collectedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.stores[0].status, "success");
});

test("100家店铺复用同一批量流程，单店失败不阻断其余店铺", async () => {
  const workbookPath = path.join(__dirname, "..", "outputs", "019fbb96-c39c-7ec1-899b-038594c1381a", "店铺指标数据源.xlsx");
  const stores = Array.from({ length: 100 }, (_unused, index) => {
    const storeNumber = index + 1;
    return createJdStoreConfig({
      key: `jd${storeNumber}`,
      displayName: `京东${storeNumber}店`,
      username: `store-${storeNumber}`,
      password: `store-${storeNumber}-pass`
    });
  });
  const calledStoreKeys = [];
  const stateStore = createControlCenterStateStore();
  const result = await runConfiguredStoresTask(stateStore, {
    readConfig() {
      return {
        workbook: { path: workbookPath },
        dateSelection: { mode: "automatic", manual: { snapshotDate: "2026-07-31" } },
        jd: { stores }
      };
    },
    findSuccessfulRun() { return null; },
    assertWorkbookWritable() {},
    ensureStoreFailureEvidence() { return []; },
    appendSuccessfulRun() {},
    async collectStoreMetrics({ store }) {
      calledStoreKeys.push(store.key);
      if (store.key === "jd50") throw new Error("模拟第50家店失败");
      return { metricCount: 1 };
    }
  });
  assert.equal(calledStoreKeys.length, 100);
  assert.equal(new Set(calledStoreKeys).size, 100);
  assert.equal(calledStoreKeys.at(0), "jd1");
  assert.equal(calledStoreKeys.at(-1), "jd100");
  assert.equal(result.successCount, 99);
  assert.equal(result.errorCount, 1);
  assert.equal(result.metricCount, 99);
  assert.equal(result.stores.find((store) => store.storeKey === "jd50").status, "error");
  assert.equal(result.stores.find((store) => store.storeKey === "jd100").status, "success");
});

test("汇总表被占用时1家和100家都在登录前停止", async () => {
  const workbookPath = path.join(__dirname, "..", "outputs", "019fbb96-c39c-7ec1-899b-038594c1381a", "店铺指标数据源.xlsx");
  for (const storeCount of [1, 100]) {
    const stores = Array.from({ length: storeCount }, (_unused, index) => createJdStoreConfig({
      key: `jd${index + 1}`,
      displayName: `京东${index + 1}店`,
      username: `store-${index + 1}`,
      password: `store-${index + 1}-pass`
    }));
    let collectedStoreCount = 0;
    const stateStore = createControlCenterStateStore();
    await assert.rejects(
      runConfiguredStoresTask(stateStore, {
        readConfig() {
          return {
            workbook: { path: workbookPath },
            dateSelection: { mode: "automatic", manual: { snapshotDate: "2026-07-31" } },
            jd: { stores }
          };
        },
        assertWorkbookWritable() {
          const error = new Error("汇总表正在被WPS或Excel占用，请先保存并关闭汇总表");
          error.code = "WORKBOOK_IN_USE";
          throw error;
        },
        ensureBatchFailureEvidence() { return []; },
        async collectStoreMetrics() {
          collectedStoreCount += 1;
          return { metricCount: 1 };
        }
      }),
      /汇总表正在被WPS或Excel占用/
    );
    assert.equal(collectedStoreCount, 0);
    assert.equal(stateStore.read().status, "error");
    assert.equal(stateStore.read().storeResults.length, 0);
  }
});

test("京东、天猫与拼多多店铺共用一条批量流程并按平台选择采集器", async () => {
  const workbookPath = path.join(__dirname, "..", "outputs", "019fbb96-c39c-7ec1-899b-038594c1381a", "店铺指标数据源.xlsx");
  const jdStore = createJdStoreConfig({
    key: "jd1", displayName: "京东1店", username: "jd-user", password: "jd-pass"
  });
  const tmallStore = {
    platformKey: "tmall",
    key: "tmall1",
    displayName: "天猫1店",
    enabled: true,
    username: "tmall-user",
    password: "tmall-pass",
    sources: { serverReport: "https://qn.taobao.com/home.html/voc-tmall/serverReport" }
  };
  const pddStore = {
    platformKey: "pdd",
    key: "pdd02",
    displayName: "德达拼多多02",
    enabled: true,
    username: "pdd-user",
    password: "pdd-pass",
    sources: { customer: "https://mms.pinduoduo.com/sycm/goods_quality/customer" }
  };
  const calledPlatforms = [];
  const stateStore = createControlCenterStateStore();
  const result = await runConfiguredStoresTask(stateStore, {
    readConfig() {
      return {
        workbook: { path: workbookPath },
        dateSelection: { mode: "automatic", manual: { snapshotDate: "2026-08-01" } },
        jd: { stores: [jdStore] },
        tmall: { stores: [tmallStore] },
        pdd: { stores: [pddStore] }
      };
    },
    findSuccessfulRun() { return null; },
    appendSuccessfulRun() {},
    assertWorkbookWritable() {},
    async collectJdStoreMetrics({ store }) {
      calledPlatforms.push(`${store.platformKey}:${store.key}`);
      return { metricCount: 38 };
    },
    async collectTmallStoreMetrics({ store }) {
      calledPlatforms.push(`${store.platformKey}:${store.key}`);
      return { metricCount: 13 };
    },
    async collectPddStoreMetrics({ store }) {
      calledPlatforms.push(`${store.platformKey}:${store.key}`);
      return { metricCount: 28 };
    }
  });
  assert.deepEqual(calledPlatforms, ["jd:jd1", "tmall:tmall1", "pdd:pdd02"]);
  assert.equal(result.successCount, 3);
  assert.equal(result.metricCount, 79);
});

test("抖音店铺可以沿用共享登录会话并进入统一批量流程", async () => {
  const workbookPath = path.join(__dirname, "..", "outputs", "019fbb96-c39c-7ec1-899b-038594c1381a", "店铺指标数据源.xlsx");
  const douyinStore = {
    platformKey: "douyin",
    key: "douyin1",
    displayName: "德达抖音",
    enabled: true,
    platformStoreId: "162329841",
    platformStoreName: "德达医疗康养器械旗舰店",
    username: "",
    password: "",
    sources: { experienceScore: "https://fxg.jinritemai.com/ffa/eco/experience-score" }
  };
  const calledStoreKeys = [];
  const stateStore = createControlCenterStateStore();
  const result = await runConfiguredStoresTask(stateStore, {
    readConfig() {
      return {
        workbook: { path: workbookPath },
        dateSelection: { mode: "automatic", manual: { snapshotDate: "2026-08-01" } },
        jd: { stores: [] },
        tmall: { stores: [] },
        pdd: { stores: [] },
        douyin: { stores: [douyinStore] }
      };
    },
    findSuccessfulRun() { return null; },
    appendSuccessfulRun() {},
    assertWorkbookWritable() {},
    async collectDouyinStoreMetrics({ store }) {
      calledStoreKeys.push(store.key);
      return { metricCount: 14 };
    }
  });
  assert.deepEqual(calledStoreKeys, ["douyin1"]);
  assert.equal(result.successCount, 1);
  assert.equal(result.metricCount, 14);
});

test("强制采集范围只执行指定平台或指定店铺", async () => {
  const workbookPath = path.join(__dirname, "..", "outputs", "019fbb96-c39c-7ec1-899b-038594c1381a", "店铺指标数据源.xlsx");
  const stores = {
    jd: [createJdStoreConfig({ key: "jd1", displayName: "京东1店", username: "jd1", password: "pass" })],
    tmall: [{ platformKey: "tmall", key: "tmall1", displayName: "天猫1店", enabled: true, username: "tmall", password: "pass" }],
    pdd: [
      { platformKey: "pdd", key: "pdd1", displayName: "拼多多1店", enabled: true, username: "pdd1", password: "pass" },
      { platformKey: "pdd", key: "pdd2", displayName: "拼多多2店", enabled: true, username: "pdd2", password: "pass" }
    ]
  };
  const runWithScope = async (collectionScope) => {
    const calledStoreKeys = [];
    const stateStore = createControlCenterStateStore();
    const result = await runConfiguredStoresTask(stateStore, {
      collectionScope,
      readConfig() {
        return {
          workbook: { path: workbookPath },
          dateSelection: { mode: "automatic", manual: { snapshotDate: "2026-08-01" } },
          jd: { stores: stores.jd },
          tmall: { stores: stores.tmall },
          pdd: { stores: stores.pdd }
        };
      },
      findSuccessfulRun() { return null; },
      appendSuccessfulRun() {},
      assertWorkbookWritable() {},
      async collectStoreMetrics({ store }) {
        calledStoreKeys.push(`${store.platformKey}:${store.key}`);
        return { metricCount: 1 };
      }
    });
    return { result, calledStoreKeys };
  };

  const pddRun = await runWithScope({ type: "platform", platformKey: "pdd" });
  assert.deepEqual(pddRun.calledStoreKeys, ["pdd:pdd1", "pdd:pdd2"]);
  assert.equal(pddRun.result.totalStoreCount, 2);

  const singleStoreRun = await runWithScope({ type: "store", platformKey: "pdd", storeKey: "pdd2" });
  assert.deepEqual(singleStoreRun.calledStoreKeys, ["pdd:pdd2"]);
  assert.equal(singleStoreRun.result.totalStoreCount, 1);
});
