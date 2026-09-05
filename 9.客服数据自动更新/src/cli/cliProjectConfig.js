const path = require("path");
const { readProjectConfig, saveProjectConfig } = require("../config/projectConfigServiceParts/projectConfigPersistence");
const { buildStoreDownloadDirFromRoot } = require("../config/projectConfigServiceParts/projectConfigDownloadPaths");
const { createManualExportDateRangeConfig } = require("../shared/exportDateRange");

const PLATFORM_KEYS = ["tmall", "jd", "pdd", "douyin"];

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function findStore(projectConfig, platformKey, storeKey) {
  return (projectConfig?.[platformKey]?.stores || []).find((store) => store.key === storeKey);
}
function updateProjectConfig(mutator, saveOptions = {}) {
  const nextConfig = readProjectConfig();
  mutator(nextConfig);
  return saveProjectConfig(nextConfig, saveOptions);
}
function createUniqueStoreKey(projectConfig, platformKey) {
  const existingKeys = new Set((projectConfig?.[platformKey]?.stores || []).map((store) => store.key));
  let suffix = Date.now();
  while (existingKeys.has(`${platformKey}${suffix}`)) suffix += 1;
  return `${platformKey}${suffix}`;
}
function addPlatformStore(platformKey) {
  if (!PLATFORM_KEYS.includes(platformKey)) throw new Error(`不支持的平台：${platformKey}`);
  let newStoreKey = "";
  const projectConfig = updateProjectConfig((draftConfig) => {
    const stores = draftConfig[platformKey].stores;
    const templateStore = stores[0];
    if (!templateStore) throw new Error(`请先保留至少一个${platformKey}模板店铺。`);
    newStoreKey = createUniqueStoreKey(draftConfig, platformKey);
    const newStore = clone(templateStore);
    Object.assign(newStore, {
      key: newStoreKey, includedInSummary: true, displayName: "新店铺", platformStoreId: "", platformStoreName: "",
      username: "", password: "", usesGlobalExportDateRange: true,
      ...(platformKey === "pdd" ? { expectedIdentityText: "" } : {}),
      exportDateRange: clone(draftConfig.globalDefaults.exportDateRange),
      downloadDir: buildStoreDownloadDirFromRoot(draftConfig.globalDefaults.downloadRootDir, platformKey, newStoreKey)
    });
    stores.push(newStore);
  });
  return { projectConfig, newStoreKey };
}
function patchPlatformStore(platformKey, storeKey, storePatch) {
  return updateProjectConfig((draftConfig) => {
    const store = findStore(draftConfig, platformKey, storeKey);
    if (!store) throw new Error(`找不到店铺：${platformKey}/${storeKey}`);
    Object.assign(store, clone(storePatch));
  });
}
function patchReportProfile(platformKey, storeKey, reportKey, profilePatch) {
  return updateProjectConfig((draftConfig) => {
    const store = findStore(draftConfig, platformKey, storeKey);
    if (!store?.reportProfiles?.[reportKey]) throw new Error(`找不到客服指标：${reportKey}`);
    Object.assign(store.reportProfiles[reportKey], clone(profilePatch));
  });
}
function applyStoreCustomDateRange(platformKey, storeKey, startDate, endDate) {
  return patchPlatformStore(platformKey, storeKey, {
    usesGlobalExportDateRange: false,
    exportDateRange: createManualExportDateRangeConfig(startDate, endDate)
  });
}
function restoreStoreGlobalDateRange(platformKey, storeKey) {
  const projectConfig = readProjectConfig();
  return patchPlatformStore(platformKey, storeKey, {
    usesGlobalExportDateRange: true,
    exportDateRange: clone(projectConfig.globalDefaults.exportDateRange)
  });
}
function normalizeUserPath(rawPath) {
  const trimmedPath = String(rawPath || "").trim().replace(/^"|"$/g, "");
  return trimmedPath ? path.resolve(trimmedPath) : "";
}

module.exports = {
  PLATFORM_KEYS, clone, findStore, updateProjectConfig, addPlatformStore, patchPlatformStore,
  patchReportProfile, applyStoreCustomDateRange, restoreStoreGlobalDateRange, normalizeUserPath
};
