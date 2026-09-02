// 该文件只负责调度单个平台全部店铺的配置校验与规范化。
const { resolveExportDateRangeToManualConfig } = require("../../shared/exportDateRange");
const { createFallbackStoreTemplate } = require("../projectConfigStoreHelpers");
const { validateStoreReportProfiles } = require("../storeReportProfileHelpers");
const {
  applyPlatformReportDefaultSource
} = require("../platformReportRuleParts/platformReportRuleService");
const {
  normalizeString,
  normalizeColumnRef,
  normalizeBoolean
} = require("./projectConfigValuePrimitives");
const { resolveStoreDownloadDir } = require("./projectConfigDownloadPaths");
const { mergePlatformWithDefaults } = require("./projectConfigPlatformMerge");
const {
  validateOfficialReportSources,
  forceUnsupportedReportProfilesDisabled
} = require("./projectConfigReportValidation");

function validatePlatformStores(platformKey, platformPayload, defaultPlatform, platformLabel, options = {}) {
  // 该函数只调度一个平台全部店铺的字段、日期、目录和报表校验。
  const safePlatform = mergePlatformWithDefaults(defaultPlatform, platformPayload);
  const allowEmptyStores = options.allowEmptyStores === true;
  const stores = Array.isArray(safePlatform.stores) ? safePlatform.stores : [];

  if (!allowEmptyStores && stores.length === 0) {
    throw new Error(`${platformLabel} 店铺配置不能为空。`);
  }

  const defaultStoreMap = new Map(defaultPlatform.stores.map((store) => [store.key, store]));
  const exportBaseDate = new Date();
  const normalizedStores = stores.map((store, index) => {
    const rawStore = Array.isArray(platformPayload?.stores)
      ? platformPayload.stores.find((candidate) => normalizeString(candidate?.key) === normalizeString(store?.key))
      : null;
    const fallbackStore =
      defaultStoreMap.get(normalizeString(store?.key)) ||
      defaultPlatform.stores[index] ||
      {
        ...createFallbackStoreTemplate(),
        downloadDir: normalizeString(defaultPlatform.stores[0]?.downloadDir)
      };

    const normalizedStore = {
      key: normalizeString(store?.key || fallbackStore.key || `store${index + 1}`),
      includedInSummary: store?.includedInSummary !== false,
      displayName: normalizeString(store?.displayName || fallbackStore.displayName),
      platformStoreId: normalizeString(store?.platformStoreId || fallbackStore.platformStoreId),
      platformStoreName: normalizeString(store?.platformStoreName || fallbackStore.platformStoreName),
      username: normalizeString(store?.username),
      password: normalizeString(store?.password),
      ...(platformKey === "jd"
        ? {
            customerServiceScope: normalizeJdCustomerServiceScope(
              store?.customerServiceScope,
              fallbackStore.customerServiceScope
            )
          }
        : {}),
      downloadDir: resolveStoreDownloadDir(
        platformKey,
        normalizeString(store?.key || fallbackStore.key || `store${index + 1}`),
        store?.downloadDir,
        fallbackStore.downloadDir
      ),
      usesGlobalExportDateRange: store?.usesGlobalExportDateRange !== false,
      exportDateRange: resolveExportDateRangeToManualConfig(
        store?.exportDateRange,
        fallbackStore.exportDateRange,
        `${platformLabel} 第 ${index + 1} 个店铺导出日期`,
        exportBaseDate
      )
    };

    validateOfficialReportSources(platformKey, rawStore, `${platformLabel} 第 ${index + 1} 个店铺`);
    const storeForReportValidation = forceUnsupportedReportProfilesDisabled(platformKey, store, fallbackStore);
    normalizedStore.reportProfiles = validateStoreReportProfiles(
      storeForReportValidation.reportProfiles,
      fallbackStore,
      `${platformLabel} 第 ${index + 1} 个店铺`,
      normalizeString,
      normalizeColumnRef,
      normalizeBoolean
    );
    Object.keys(normalizedStore.reportProfiles).forEach((reportKey) => {
      normalizedStore.reportProfiles[reportKey] = applyPlatformReportDefaultSource(
        platformKey,
        reportKey,
        normalizedStore.reportProfiles[reportKey]
      );
    });

    if (!normalizedStore.key) {
      throw new Error(`${platformLabel} 第 ${index + 1} 个店铺缺少标识。`);
    }

    if (!normalizedStore.displayName) {
      throw new Error(`${platformLabel} 第 ${index + 1} 个店铺缺少名称。`);
    }

    if (!normalizedStore.downloadDir) {
      throw new Error(`${platformLabel} 第 ${index + 1} 个店铺缺少下载目录。`);
    }

    return normalizedStore;
  });

  return { stores: normalizedStores };
}

function normalizeJdCustomerServiceScope(value, fallbackValue = { mode: "客服岗位", values: ["售前"] }) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : fallbackValue;
  const mode = normalizeString(candidate?.mode || "客服岗位") || "客服岗位";
  const values = Array.isArray(candidate?.values)
    ? candidate.values.map((item) => normalizeString(item)).filter(Boolean)
    : [];
  if (!values.length) {
    throw new Error("京东客服筛选必须至少配置一个客服岗位或客服组。");
  }
  return { mode, values: [...new Set(values)] };
}

module.exports = { validatePlatformStores, normalizeJdCustomerServiceScope };
