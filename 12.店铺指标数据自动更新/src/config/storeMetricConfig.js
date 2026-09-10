const fs = require("fs");
const path = require("path");
const appConfig = require("./appConfig");
const { readJsonFile, writeJsonFileAtomic } = require("../shared/fileStore");

const neighborProjectConfigPath =
  "D:\\桌面\\办公软件\\9.客服数据自动更新\\project-config\\platform-config.json";
const jdShopStarUrl = "https://jdsz.jd.com/szweb/view/service/shop-experience-score.html";
const jdNegativeServiceUrl = "https://jdsz.jd.com/szweb/view/service/negative-service-temp.html";
const jdComplianceUrl = "https://illegal-jdm.shop.jd.com/legal";
const tmallServerReportUrl = "https://qn.taobao.com/home.html/voc-tmall/serverReport";
const pddCustomerUrl = "https://mms.pinduoduo.com/sycm/goods_quality/customer";
const douyinExperienceScoreUrl = "https://fxg.jinritemai.com/ffa/eco/experience-score?source=fxg-home&btm_ppre=a0.b0.c0.d0&btm_pre=..c0.c0";

// 日期文本格式化统一走 shared/exportDateRange 的 formatDate，这里保留导出名作薄委托。
const { formatDate } = require("../shared/exportDateRange");

function createDefaultManualDateConfig(baseDate = new Date()) {
  return {
    snapshotDate: formatDate(baseDate)
  };
}

function readNeighborStoreConfiguration(platformKey, storeKey, displayName) {
  if (!fs.existsSync(neighborProjectConfigPath)) {
    return { username: "", password: "" };
  }
  const neighborConfig = readJsonFile(neighborProjectConfigPath, "9号项目配置");
  const neighborStore = (neighborConfig?.[platformKey]?.stores || []).find(
    (store) => store?.key === storeKey || store?.displayName === displayName
  ) || {};
  return {
    username: String(neighborStore.username || ""),
    password: String(neighborStore.password || "")
  };
}

function readNeighborDouyinStoreConfiguration(storeKey, displayName) {
  if (!fs.existsSync(neighborProjectConfigPath)) {
    return { username: "", password: "", platformStoreId: "", platformStoreName: "" };
  }
  const neighborConfig = readJsonFile(neighborProjectConfigPath, "9号项目配置");
  const neighborStore = (neighborConfig?.douyin?.stores || []).find(
    (store) => store?.key === storeKey || store?.displayName === displayName
  ) || {};
  return {
    username: String(neighborStore.username || ""),
    password: String(neighborStore.password || ""),
    platformStoreId: String(neighborStore.platformStoreId || ""),
    platformStoreName: String(neighborStore.platformStoreName || "")
  };
}

function createOfficialJdStoreSources() {
  return {
    shopStar: jdShopStarUrl,
    negativeService: jdNegativeServiceUrl,
    compliance: jdComplianceUrl
  };
}

function createJdStoreConfig({ key, displayName, username = "", password = "", enabled = true }) {
  return {
    platformKey: "jd",
    key: String(key || "").trim(),
    displayName: String(displayName || "").trim(),
    enabled: enabled !== false,
    username: String(username || ""),
    password: String(password || ""),
    downloadDir: appConfig.getStoreDownloadDir("jd", String(key || "").trim()),
    sources: createOfficialJdStoreSources()
  };
}

function createOfficialTmallStoreSources() {
  return {
    serverReport: tmallServerReportUrl
  };
}

function createTmallStoreConfig({ key, displayName, username = "", password = "", enabled = true }) {
  return {
    platformKey: "tmall",
    key: String(key || "").trim(),
    displayName: String(displayName || "").trim(),
    enabled: enabled !== false,
    username: String(username || ""),
    password: String(password || ""),
    downloadDir: appConfig.getStoreDownloadDir("tmall", String(key || "").trim()),
    sources: createOfficialTmallStoreSources()
  };
}

function createOfficialPddStoreSources() {
  return {
    customer: pddCustomerUrl
  };
}

function createPddStoreConfig({ key, displayName, username = "", password = "", enabled = true }) {
  return {
    platformKey: "pdd",
    key: String(key || "").trim(),
    displayName: String(displayName || "").trim(),
    enabled: enabled !== false,
    username: String(username || ""),
    password: String(password || ""),
    downloadDir: appConfig.getStoreDownloadDir("pdd", String(key || "").trim()),
    sources: createOfficialPddStoreSources()
  };
}

function createOfficialDouyinStoreSources() {
  return {
    experienceScore: douyinExperienceScoreUrl
  };
}

function createDouyinStoreConfig({
  key,
  displayName,
  platformStoreId = "",
  platformStoreName = "",
  username = "",
  password = "",
  enabled = true
}) {
  return {
    platformKey: "douyin",
    key: String(key || "").trim(),
    displayName: String(displayName || "").trim(),
    enabled: enabled !== false,
    platformStoreId: String(platformStoreId || "").trim(),
    platformStoreName: String(platformStoreName || "").trim(),
    username: String(username || ""),
    password: String(password || ""),
    downloadDir: appConfig.getStoreDownloadDir("douyin", String(key || "").trim()),
    sources: createOfficialDouyinStoreSources()
  };
}

function normalizeStoreKeyInput(platformKey, rawStoreKey) {
  const normalizedStoreKey = String(rawStoreKey || "").trim();
  if (/^\d+$/.test(normalizedStoreKey)) {
    return `${platformKey}${normalizedStoreKey}`;
  }
  return normalizedStoreKey;
}

function createDefaultStoreMetricConfig(baseDate = new Date()) {
  const neighborJdOneConfiguration = readNeighborStoreConfiguration("jd", "jd1", "京东1店");
  const neighborTmallOneConfiguration = readNeighborStoreConfiguration("tmall", "tmall1", "天猫1店");
  const neighborPddTwoConfiguration = readNeighborStoreConfiguration("pdd", "pdd02", "德达拼多多02");
  const neighborDouyinOneConfiguration = readNeighborDouyinStoreConfiguration("douyin1", "德达抖音");
  const neighborDouyinTwoConfiguration = readNeighborDouyinStoreConfiguration("douyin2", "dedakj抖音");
  return {
    workbook: {
      path: path.join(
        appConfig.projectRoot,
        "outputs",
        "019fbb96-c39c-7ec1-899b-038594c1381a",
        "店铺指标数据源.xlsx"
      )
    },
    dateSelection: {
      mode: "automatic",
      manual: createDefaultManualDateConfig(baseDate)
    },
    kdocsDataSourceSync: {
      documentUrl: "",
      webhookUrl: "",
      apiToken: ""
    },
    jd: {
      stores: [
        createJdStoreConfig({
          key: "jd1",
          displayName: "京东1店",
          username: neighborJdOneConfiguration.username,
          password: neighborJdOneConfiguration.password
        })
      ]
    },
    tmall: {
      stores: [
        createTmallStoreConfig({
          key: "tmall1",
          displayName: "天猫1店",
          username: neighborTmallOneConfiguration.username,
          password: neighborTmallOneConfiguration.password
        })
      ]
    },
    pdd: {
      stores: [
        createPddStoreConfig({
          key: "pdd02",
          displayName: "德达拼多多02",
          username: neighborPddTwoConfiguration.username,
          password: neighborPddTwoConfiguration.password
        })
      ]
    },
    douyin: {
      stores: [
        createDouyinStoreConfig({
          key: "douyin1",
          displayName: "德达抖音",
          platformStoreId: neighborDouyinOneConfiguration.platformStoreId || "162329841",
          platformStoreName: neighborDouyinOneConfiguration.platformStoreName || "德达医疗康养器械旗舰店",
          username: neighborDouyinOneConfiguration.username,
          password: neighborDouyinOneConfiguration.password
        }),
        createDouyinStoreConfig({
          key: "douyin2",
          displayName: "dedakj抖音",
          platformStoreId: neighborDouyinTwoConfiguration.platformStoreId || "29502951",
          platformStoreName: neighborDouyinTwoConfiguration.platformStoreName || "DEDAKJ医疗器械旗舰店",
          username: neighborDouyinTwoConfiguration.username,
          password: neighborDouyinTwoConfiguration.password
        })
      ]
    }
  };
}

function normalizeKdocsDataSourceSync(kdocsDataSourceSync, fallbackKdocsDataSourceSync = {}) {
  return {
    documentUrl: String(
      kdocsDataSourceSync?.documentUrl ?? fallbackKdocsDataSourceSync.documentUrl ?? ""
    ).trim(),
    webhookUrl: String(
      kdocsDataSourceSync?.webhookUrl ?? fallbackKdocsDataSourceSync.webhookUrl ?? ""
    ).trim(),
    apiToken: String(
      kdocsDataSourceSync?.apiToken ?? fallbackKdocsDataSourceSync.apiToken ?? ""
    ).trim()
  };
}

function normalizeDateSelection(dateSelection, fallbackDateSelection) {
  const requestedMode = String(dateSelection?.mode || fallbackDateSelection.mode || "automatic");
  const mode = requestedMode === "manual" ? "manual" : "automatic";
  const fallbackManual = fallbackDateSelection.manual;
  return {
    mode,
    manual: {
      snapshotDate: String(
        dateSelection?.manual?.snapshotDate ||
        dateSelection?.manual?.endDate ||
        fallbackManual.snapshotDate
      )
    }
  };
}

// 这里把四平台同构的店铺配置逻辑收口成参数化工厂，避免修一份漏三份（issue #555）。
// 编号提取统一容忍前导零（如 jd01 视作编号 1 参与查重），该修复原先只在拼多多副本上存在。
function createPlatformStoreToolkit({ platformKey, platformLabel, createStoreConfig, buildExtraCreateFields }) {
  const storeNumberPattern = new RegExp(`^${platformKey}(?:0*)?(\\d+)$`, "i");

  function extractStoreNumber(storeKey) {
    const matched = String(storeKey || "").match(storeNumberPattern);
    return matched ? Number(matched[1]) : Number.NaN;
  }

  function normalizeStore(store, fallbackStore, storeIndex) {
    const storeKey = normalizeStoreKeyInput(
      platformKey,
      store?.key || fallbackStore?.key || `${platformKey}${storeIndex + 1}`
    );
    if (!/^[A-Za-z0-9_-]+$/.test(storeKey)) {
      throw new Error(`${platformLabel}第 ${storeIndex + 1} 家店铺编号无效：${storeKey || "空"}。`);
    }
    const displayName = String(
      store?.displayName || fallbackStore?.displayName || `${platformLabel}${storeIndex + 1}店`
    ).trim();
    if (!displayName) throw new Error(`${platformLabel}第 ${storeIndex + 1} 家店铺缺少名称。`);
    return createStoreConfig({
      key: storeKey,
      displayName,
      enabled: store?.enabled !== false,
      username: String(store?.username || fallbackStore?.username || ""),
      password: String(store?.password || fallbackStore?.password || ""),
      ...(typeof buildExtraCreateFields === "function"
        ? buildExtraCreateFields(store, fallbackStore)
        : {})
    });
  }

  function normalizeStores(configuredStores, defaultStores) {
    const sourceStores = Array.isArray(configuredStores) && configuredStores.length
      ? configuredStores
      : defaultStores;
    const defaultStoreMap = new Map(defaultStores.map((store) => [store.key, store]));
    const normalizedStores = sourceStores.map((store, storeIndex) =>
      normalizeStore(store, defaultStoreMap.get(String(store?.key || "").trim()), storeIndex));
    const storeKeys = new Set();
    for (const store of normalizedStores) {
      if (storeKeys.has(store.key)) throw new Error(`${platformLabel}店铺编号重复：${store.key}。`);
      storeKeys.add(store.key);
    }
    return normalizedStores;
  }

  function mergeStorePatches(currentStores, storePatches) {
    const mergedStores = currentStores.map((store) => ({ ...store }));
    const storeIndexByKey = new Map(mergedStores.map((store, storeIndex) => [store.key, storeIndex]));
    for (const storePatch of Array.isArray(storePatches) ? storePatches : []) {
      const currentStoreKey = String(storePatch?.key || "").trim();
      if (!storeIndexByKey.has(currentStoreKey)) {
        throw new Error(`找不到要保存的${platformLabel}店铺：${currentStoreKey || "空"}。`);
      }
      const storeIndex = storeIndexByKey.get(currentStoreKey);
      const currentStore = mergedStores[storeIndex];
      const nextStoreKey = normalizeStoreKeyInput(platformKey, storePatch?.newKey || currentStoreKey);
      const occupiedStoreIndex = storeIndexByKey.get(nextStoreKey);
      if (occupiedStoreIndex !== undefined && occupiedStoreIndex !== storeIndex) {
        throw new Error(`${platformLabel}店铺编号重复：${nextStoreKey}。`);
      }
      const nextPassword = String(storePatch.password || currentStore.password || "");
      const { key: _currentStoreKey, newKey: _newStoreKey, ...storeFields } = storePatch;
      mergedStores[storeIndex] = {
        ...currentStore,
        ...storeFields,
        key: nextStoreKey,
        password: nextPassword
      };
      storeIndexByKey.delete(currentStoreKey);
      storeIndexByKey.set(nextStoreKey, storeIndex);
    }
    return mergedStores;
  }

  function createNextStore(config, requestedStoreKey = "") {
    const configuredStores = config?.[platformKey]?.stores || [];
    const usedStoreNumbers = new Set(
      configuredStores.map((store) => extractStoreNumber(store.key)).filter(Number.isInteger)
    );
    const normalizedRequestedStoreKey = normalizeStoreKeyInput(platformKey, requestedStoreKey);
    if (normalizedRequestedStoreKey) {
      if (configuredStores.some((store) => store.key === normalizedRequestedStoreKey)) {
        throw new Error(`${platformLabel}店铺编号重复：${normalizedRequestedStoreKey}。`);
      }
      return createStoreConfig({
        key: normalizedRequestedStoreKey,
        displayName: `${platformLabel}${normalizedRequestedStoreKey.replace(new RegExp(`^${platformKey}`, "i"), "")}店`
      });
    }
    let nextStoreNumber = 1;
    while (usedStoreNumbers.has(nextStoreNumber)) nextStoreNumber += 1;
    return createStoreConfig({
      key: `${platformKey}${nextStoreNumber}`,
      displayName: `${platformLabel}${nextStoreNumber}店`
    });
  }

  function addStoreConfig(currentConfig = readStoreMetricConfig(), requestedStoreKey = "") {
    const newStore = createNextStore(currentConfig, requestedStoreKey);
    const nextConfig = normalizeStoreMetricConfig({
      ...currentConfig,
      [platformKey]: { stores: [...currentConfig[platformKey].stores, newStore] }
    });
    writeJsonFileAtomic(appConfig.projectConfigPath, nextConfig);
    return { config: nextConfig, newStore };
  }

  function listEnabledStores(config) {
    return (config?.[platformKey]?.stores || []).filter((store) => store?.enabled !== false);
  }

  return {
    mergeStorePatches,
    createNextStore,
    addStoreConfig,
    listEnabledStores,
    normalizeStores
  };
}

const jdStoreToolkit = createPlatformStoreToolkit({
  platformKey: "jd",
  platformLabel: "京东",
  createStoreConfig: createJdStoreConfig
});
const tmallStoreToolkit = createPlatformStoreToolkit({
  platformKey: "tmall",
  platformLabel: "天猫",
  createStoreConfig: createTmallStoreConfig
});
const pddStoreToolkit = createPlatformStoreToolkit({
  platformKey: "pdd",
  platformLabel: "拼多多",
  createStoreConfig: createPddStoreConfig
});
const douyinStoreToolkit = createPlatformStoreToolkit({
  platformKey: "douyin",
  platformLabel: "抖音",
  createStoreConfig: createDouyinStoreConfig,
  buildExtraCreateFields: (store, fallbackStore) => ({
    platformStoreId: String(store?.platformStoreId || fallbackStore?.platformStoreId || ""),
    platformStoreName: String(store?.platformStoreName || fallbackStore?.platformStoreName || "")
  })
});

function normalizeStoreMetricConfig(config, baseDate = new Date()) {
  const defaults = createDefaultStoreMetricConfig(baseDate);
  return {
    workbook: {
      path: String(config?.workbook?.path || defaults.workbook.path).trim()
    },
    dateSelection: normalizeDateSelection(config?.dateSelection, defaults.dateSelection),
    kdocsDataSourceSync: normalizeKdocsDataSourceSync(
      config?.kdocsDataSourceSync,
      defaults.kdocsDataSourceSync
    ),
    jd: {
      stores: jdStoreToolkit.normalizeStores(config?.jd?.stores, defaults.jd.stores)
    },
    tmall: {
      stores: tmallStoreToolkit.normalizeStores(config?.tmall?.stores, defaults.tmall.stores)
    },
    pdd: {
      stores: pddStoreToolkit.normalizeStores(config?.pdd?.stores, defaults.pdd.stores)
    },
    douyin: {
      stores: douyinStoreToolkit.normalizeStores(config?.douyin?.stores, defaults.douyin.stores)
    }
  };
}

function readStoreMetricConfig(baseDate = new Date()) {
  const rawConfig = fs.existsSync(appConfig.projectConfigPath)
    ? readJsonFile(appConfig.projectConfigPath, "店铺指标配置")
    : createDefaultStoreMetricConfig(baseDate);
  return normalizeStoreMetricConfig(rawConfig, baseDate);
}

function ensureStoreMetricConfig(baseDate = new Date()) {
  if (fs.existsSync(appConfig.projectConfigPath)) {
    return readStoreMetricConfig(baseDate);
  }
  const normalizedConfig = readStoreMetricConfig(baseDate);
  writeJsonFileAtomic(appConfig.projectConfigPath, normalizedConfig);
  return normalizedConfig;
}

// 这里保留原导出名作薄委托，实际逻辑统一在 createPlatformStoreToolkit（issue #555）。
function mergeJdStorePatches(currentStores, storePatches) {
  return jdStoreToolkit.mergeStorePatches(currentStores, storePatches);
}

function mergeTmallStorePatches(currentStores, storePatches) {
  return tmallStoreToolkit.mergeStorePatches(currentStores, storePatches);
}

function mergePddStorePatches(currentStores, storePatches) {
  return pddStoreToolkit.mergeStorePatches(currentStores, storePatches);
}

function mergeDouyinStorePatches(currentStores, storePatches) {
  return douyinStoreToolkit.mergeStorePatches(currentStores, storePatches);
}

function saveStoreMetricConfig(nextConfig, currentConfig = readStoreMetricConfig()) {
  const mergedConfig = {
    ...currentConfig,
    ...nextConfig,
    workbook: {
      ...currentConfig.workbook,
      ...(nextConfig?.workbook || {})
    },
    dateSelection: {
      ...currentConfig.dateSelection,
      ...(nextConfig?.dateSelection || {}),
      manual: {
        ...currentConfig.dateSelection.manual,
        ...(nextConfig?.dateSelection?.manual || {})
      }
    },
    kdocsDataSourceSync: {
      ...currentConfig.kdocsDataSourceSync,
      ...(nextConfig?.kdocsDataSourceSync || {})
    },
    jd: {
      stores: mergeJdStorePatches(currentConfig.jd.stores, nextConfig?.jd?.stores)
    },
    tmall: {
      stores: mergeTmallStorePatches(currentConfig.tmall.stores, nextConfig?.tmall?.stores)
    },
    pdd: {
      stores: mergePddStorePatches(currentConfig.pdd.stores, nextConfig?.pdd?.stores)
    },
    douyin: {
      stores: mergeDouyinStorePatches(currentConfig.douyin.stores, nextConfig?.douyin?.stores)
    }
  };
  const normalizedConfig = normalizeStoreMetricConfig(mergedConfig);
  writeJsonFileAtomic(appConfig.projectConfigPath, normalizedConfig);
  return normalizedConfig;
}

// 这里保留原导出名作薄委托，新增店铺编号查重与自动分配统一走 toolkit（issue #555）。
function createNextJdStore(config, requestedStoreKey = "") {
  return jdStoreToolkit.createNextStore(config, requestedStoreKey);
}

function addJdStoreConfig(currentConfig = readStoreMetricConfig(), requestedStoreKey = "") {
  return jdStoreToolkit.addStoreConfig(currentConfig, requestedStoreKey);
}

function createNextTmallStore(config, requestedStoreKey = "") {
  return tmallStoreToolkit.createNextStore(config, requestedStoreKey);
}

function addTmallStoreConfig(currentConfig = readStoreMetricConfig(), requestedStoreKey = "") {
  return tmallStoreToolkit.addStoreConfig(currentConfig, requestedStoreKey);
}

function createNextPddStore(config, requestedStoreKey = "") {
  return pddStoreToolkit.createNextStore(config, requestedStoreKey);
}

function addPddStoreConfig(currentConfig = readStoreMetricConfig(), requestedStoreKey = "") {
  return pddStoreToolkit.addStoreConfig(currentConfig, requestedStoreKey);
}

function createNextDouyinStore(config, requestedStoreKey = "") {
  return douyinStoreToolkit.createNextStore(config, requestedStoreKey);
}

function addDouyinStoreConfig(currentConfig = readStoreMetricConfig(), requestedStoreKey = "") {
  return douyinStoreToolkit.addStoreConfig(currentConfig, requestedStoreKey);
}

function resolveConfiguredDateSelection(config, baseDate = new Date()) {
  if (config.dateSelection.mode === "manual") {
    return {
      mode: "manual",
      snapshotDate: String(config.dateSelection.manual.snapshotDate || formatDate(baseDate))
    };
  }
  return {
    mode: "automatic",
    snapshotDate: ""
  };
}

// 这里保留原导出名作薄委托；原 getJdStore 全仓无消费者，已随本次收口删除（issue #555）。
function listEnabledJdStores(config) {
  return jdStoreToolkit.listEnabledStores(config);
}

function listEnabledTmallStores(config) {
  return tmallStoreToolkit.listEnabledStores(config);
}

function listEnabledPddStores(config) {
  return pddStoreToolkit.listEnabledStores(config);
}

function listEnabledDouyinStores(config) {
  return douyinStoreToolkit.listEnabledStores(config);
}

function listEnabledStoreTasks(config) {
  return [
    ...listEnabledJdStores(config).map((store) => ({ ...store, platformKey: "jd" })),
    ...listEnabledTmallStores(config).map((store) => ({ ...store, platformKey: "tmall" })),
    ...listEnabledPddStores(config).map((store) => ({ ...store, platformKey: "pdd" })),
    ...listEnabledDouyinStores(config).map((store) => ({ ...store, platformKey: "douyin" }))
  ];
}

function createPublicConfig(config) {
  const kdocsDataSourceSync = config.kdocsDataSourceSync || {};
  return {
    workbook: config.workbook,
    dateSelection: config.dateSelection,
    kdocsDataSourceSync: {
      documentUrl: kdocsDataSourceSync.documentUrl || "",
      webhookUrl: "",
      webhookConfigured: Boolean(kdocsDataSourceSync.webhookUrl),
      apiToken: "",
      apiTokenConfigured: Boolean(kdocsDataSourceSync.apiToken)
    },
    jd: {
      stores: config.jd.stores.map((store) => {
        const { downloadDir: _internalDownloadDirectory, ...publicStore } = store;
        return {
          ...publicStore,
          password: "",
          passwordConfigured: Boolean(store.password)
        };
      })
    },
    tmall: {
      stores: config.tmall.stores.map((store) => {
        const { downloadDir: _internalDownloadDirectory, ...publicStore } = store;
        return {
          ...publicStore,
          password: "",
          passwordConfigured: Boolean(store.password)
        };
      })
    },
    pdd: {
      stores: config.pdd.stores.map((store) => {
        const { downloadDir: _internalDownloadDirectory, ...publicStore } = store;
        return {
          ...publicStore,
          password: "",
          passwordConfigured: Boolean(store.password)
        };
      })
    },
    douyin: {
      stores: config.douyin.stores.map((store) => {
        const { downloadDir: _internalDownloadDirectory, ...publicStore } = store;
        return {
          ...publicStore,
          password: "",
          passwordConfigured: Boolean(store.password)
        };
      })
    }
  };
}

module.exports = {
  formatDate,
  readStoreMetricConfig,
  ensureStoreMetricConfig,
  saveStoreMetricConfig,
  mergeJdStorePatches,
  mergeTmallStorePatches,
  mergePddStorePatches,
  mergeDouyinStorePatches,
  addJdStoreConfig,
  addTmallStoreConfig,
  addPddStoreConfig,
  addDouyinStoreConfig,
  resolveConfiguredDateSelection,
  listEnabledJdStores,
  listEnabledTmallStores,
  listEnabledPddStores,
  listEnabledDouyinStores,
  listEnabledStoreTasks,
  createPublicConfig,
  createJdStoreConfig,
  createTmallStoreConfig,
  createPddStoreConfig,
  createDouyinStoreConfig,
  normalizeStoreKeyInput,
  createNextJdStore,
  createNextTmallStore,
  createNextPddStore,
  createNextDouyinStore,
  createDefaultStoreMetricConfig,
  normalizeStoreMetricConfig,
  normalizeKdocsDataSourceSync
};
