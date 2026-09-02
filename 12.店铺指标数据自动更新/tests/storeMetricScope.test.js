const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createDefaultStoreMetricConfig,
  normalizeStoreMetricConfig,
  resolveConfiguredDateSelection,
  createPublicConfig,
  createNextJdStore,
  createNextTmallStore,
  createNextPddStore,
  createNextDouyinStore,
  normalizeStoreKeyInput,
  mergeJdStorePatches,
  mergeTmallStorePatches,
  mergePddStorePatches,
  listEnabledStoreTasks
} = require("../src/config/storeMetricConfig");
const {
  filterStoreTasksByCollectionScope,
  formatStoreCollectionScope
} = require("../src/shared/storeCollectionScope");

test("店铺项目配置不再包含客服下载和个人分组", () => {
  const normalizedConfig = normalizeStoreMetricConfig({
    dateSelection: {
      mode: "automatic",
      automation: { dateRangeDayCount: 30, endDateDelayDayCount: 2 },
      manual: { startDate: "2026-07-01", endDate: "2026-07-30", snapshotDate: "2026-07-30" }
    },
    jd: {
      stores: [{
        key: "jd1",
        personMappings: [{ summaryName: "旧客服" }],
        sources: { receptionData: "https://example.test/ReceptionData" }
      }]
    }
  }, new Date("2026-08-01T00:00:00+08:00"));
  const store = normalizedConfig.jd.stores[0];
  assert.deepEqual(Object.keys(store.sources).sort(), ["compliance", "negativeService", "shopStar"]);
  assert.equal("personMappings" in store, false);
  assert.equal("automation" in normalizedConfig.dateSelection, false);
  assert.deepEqual(normalizedConfig.dateSelection.manual, { snapshotDate: "2026-07-30" });
  const publicStore = createPublicConfig(normalizedConfig).jd.stores[0];
  assert.equal("personMappingCount" in publicStore, false);
  assert.equal("downloadDir" in publicStore, false);
});

test("多家京东店铺会全部保留并使用独立配置", () => {
  const normalizedConfig = normalizeStoreMetricConfig({
    jd: {
      stores: [
        { key: "jd1", displayName: "京东1店", enabled: true, username: "one", password: "secret-one" },
        { key: "jd2", displayName: "京东2店", enabled: false, username: "two", password: "secret-two" }
      ]
    }
  }, new Date("2026-08-01T00:00:00+08:00"));
  assert.equal(normalizedConfig.jd.stores.length, 2);
  assert.equal(normalizedConfig.jd.stores[1].enabled, false);
  assert.notEqual(normalizedConfig.jd.stores[0].downloadDir, normalizedConfig.jd.stores[1].downloadDir);
  const publicStores = createPublicConfig(normalizedConfig).jd.stores;
  assert.deepEqual(publicStores.map((store) => store.password), ["", ""]);
  assert.deepEqual(publicStores.map((store) => store.passwordConfigured), [true, true]);
});

test("新增京东店铺使用最小可用编号，局部保存不清空旧密码", () => {
  const config = normalizeStoreMetricConfig({
    jd: {
      stores: [
        { key: "jd1", displayName: "京东1店", password: "secret-one" },
        { key: "jd3", displayName: "京东3店", password: "secret-three" }
      ]
    }
  });
  assert.equal(createNextJdStore(config).key, "jd2");
  const mergedStores = mergeJdStorePatches(config.jd.stores, [{
    key: "jd1",
    displayName: "京东旗舰店",
    password: ""
  }]);
  assert.equal(mergedStores[0].displayName, "京东旗舰店");
  assert.equal(mergedStores[0].password, "secret-one");
  assert.equal(mergedStores[1].displayName, "京东3店");
});

test("天猫、拼多多和抖音店铺使用独立配置并共同进入店铺任务列表", () => {
  const config = normalizeStoreMetricConfig({
    jd: { stores: [{ key: "jd1", displayName: "京东1店", enabled: false }] },
    tmall: {
      stores: [
        { key: "tmall1", displayName: "天猫1店", username: "one", password: "secret-one" },
        { key: "tmall3", displayName: "天猫3店", username: "three", password: "secret-three" }
      ]
    },
    pdd: {
      stores: [{ key: "pdd02", displayName: "德达拼多多02", username: "pdd", password: "secret-pdd" }]
    }
  });
  assert.equal(createNextTmallStore(config).key, "tmall2");
  assert.equal(createNextPddStore(config, "6").key, "pdd6");
  assert.equal(createNextDouyinStore(config).key, "douyin3");
  assert.deepEqual(listEnabledStoreTasks(config).map((store) => store.key), ["tmall1", "tmall3", "pdd02", "douyin1", "douyin2"]);
  const mergedStores = mergeTmallStorePatches(config.tmall.stores, [{ key: "tmall1", displayName: "天猫旗舰店" }]);
  assert.equal(mergedStores[0].password, "secret-one");
  assert.equal(mergedStores[0].displayName, "天猫旗舰店");
  const publicStore = createPublicConfig(config).tmall.stores[0];
  assert.equal(publicStore.password, "");
  assert.equal(publicStore.passwordConfigured, true);
  assert.equal(publicStore.sources.serverReport, "https://qn.taobao.com/home.html/voc-tmall/serverReport");
  const publicPddStore = createPublicConfig(config).pdd.stores[0];
  assert.equal(publicPddStore.password, "");
  assert.equal(publicPddStore.passwordConfigured, true);
  assert.equal(publicPddStore.sources.customer, "https://mms.pinduoduo.com/sycm/goods_quality/customer");
  const publicDouyinStore = createPublicConfig(config).douyin.stores[0];
  assert.equal(publicDouyinStore.platformStoreId, "162329841");
  assert.equal(publicDouyinStore.platformStoreName, "德达医疗康养器械旗舰店");
  const mergedPddStores = mergePddStorePatches(config.pdd.stores, [{ key: "pdd02", newKey: "6" }]);
  assert.equal(mergedPddStores[0].key, "pdd6");
});

test("店铺编号可以跳号，修改6店会把数字编号标准化为平台编号", () => {
  const config = normalizeStoreMetricConfig({
    tmall: {
      stores: [
        { key: "tmall1", displayName: "天猫1店" },
        { key: "tmall2", displayName: "天猫2店" },
        { key: "tmall3", displayName: "天猫6店" }
      ]
    }
  });
  assert.equal(normalizeStoreKeyInput("tmall", "6"), "tmall6");
  assert.equal(createNextTmallStore(config, "6").key, "tmall6");
  const renamedStores = mergeTmallStorePatches(config.tmall.stores, [{ key: "tmall3", newKey: "6" }]);
  assert.equal(renamedStores[2].key, "tmall6");
  assert.equal(renamedStores[2].displayName, "天猫6店");
  const normalizedRenamedStore = normalizeStoreMetricConfig({ tmall: { stores: renamedStores } })
    .tmall.stores[2];
  assert.match(normalizedRenamedStore.downloadDir, /tmall[\\/]tmall6$/);
});

test("智能日期读取最新页面，手动日期指定平台快照单日", () => {
  const config = createDefaultStoreMetricConfig(new Date("2026-08-01T00:00:00+08:00"));
  assert.deepEqual(resolveConfiguredDateSelection(config), { mode: "automatic", snapshotDate: "" });
  config.dateSelection.mode = "manual";
  config.dateSelection.manual.snapshotDate = "2026-07-31";
  assert.deepEqual(resolveConfiguredDateSelection(config), { mode: "manual", snapshotDate: "2026-07-31" });
});

test("强制采集范围支持全部店铺、平台和单店三级筛选", () => {
  const config = normalizeStoreMetricConfig({
    jd: { stores: [
      { key: "jd1", displayName: "京东1店" },
      { key: "jd2", displayName: "京东2店" }
    ] },
    tmall: { stores: [{ key: "tmall1", displayName: "天猫1店" }] },
    pdd: { stores: [{ key: "pdd1", displayName: "拼多多1店" }] }
  });
  const allStores = listEnabledStoreTasks(config);
  assert.equal(filterStoreTasksByCollectionScope(allStores, { type: "all" }).length, 6);
  assert.deepEqual(
    filterStoreTasksByCollectionScope(allStores, { type: "platform", platformKey: "tmall" })
      .map((store) => store.key),
    ["tmall1"]
  );
  assert.deepEqual(
    filterStoreTasksByCollectionScope(allStores, { type: "store", platformKey: "jd", storeKey: "jd2" })
      .map((store) => store.key),
    ["jd2"]
  );
  assert.equal(formatStoreCollectionScope({ type: "all" }), "全部店铺");
  assert.equal(formatStoreCollectionScope({ type: "platform", platformKey: "pdd" }), "拼多多全部店铺");
  assert.equal(formatStoreCollectionScope({ type: "store", platformKey: "jd", storeKey: "jd2" }), "京东 · jd2");
});
