const PLATFORM_SCOPE_DEFINITIONS = [
  { platformKey: "jd", platformName: "京东" },
  { platformKey: "tmall", platformName: "天猫" },
  { platformKey: "pdd", platformName: "拼多多" },
  { platformKey: "douyin", platformName: "抖音" }
];

function getPlatformScopeDefinition(platformKey) {
  return PLATFORM_SCOPE_DEFINITIONS.find(
    (definition) => definition.platformKey === String(platformKey || "").trim()
  );
}

function normalizeStoreCollectionScope(scope) {
  if (!scope || scope.type === "all") return { type: "all" };
  if (scope.type === "platform") {
    const platformKey = String(scope.platformKey || "").trim();
    if (!getPlatformScopeDefinition(platformKey)) {
      throw new Error(`强制采集平台范围无效：${platformKey || "空"}。`);
    }
    return { type: "platform", platformKey };
  }
  if (scope.type === "store") {
    const platformKey = String(scope.platformKey || "").trim();
    const storeKey = String(scope.storeKey || "").trim();
    if (!getPlatformScopeDefinition(platformKey) || !storeKey) {
      throw new Error("强制采集店铺范围无效，请重新选择平台和店铺。");
    }
    return { type: "store", platformKey, storeKey };
  }
  throw new Error(`强制采集范围无效：${String(scope.type || "空")}。`);
}

function getStoreTaskPlatformKey(store) {
  return String(store?.platformKey || "jd").trim();
}

function filterStoreTasksByCollectionScope(storeTasks, scope) {
  const normalizedScope = normalizeStoreCollectionScope(scope);
  const sourceStoreTasks = Array.isArray(storeTasks) ? storeTasks : [];
  if (normalizedScope.type === "all") return sourceStoreTasks;
  return sourceStoreTasks.filter((store) => {
    const platformKey = getStoreTaskPlatformKey(store);
    if (platformKey !== normalizedScope.platformKey) return false;
    return normalizedScope.type !== "store" || store?.key === normalizedScope.storeKey;
  });
}

function formatStoreCollectionScope(scope) {
  const normalizedScope = normalizeStoreCollectionScope(scope);
  if (normalizedScope.type === "all") return "全部店铺";
  const platformDefinition = getPlatformScopeDefinition(normalizedScope.platformKey);
  if (normalizedScope.type === "platform") return `${platformDefinition.platformName}全部店铺`;
  return `${platformDefinition.platformName} · ${normalizedScope.storeKey}`;
}

module.exports = {
  PLATFORM_SCOPE_DEFINITIONS,
  getPlatformScopeDefinition,
  normalizeStoreCollectionScope,
  getStoreTaskPlatformKey,
  filterStoreTasksByCollectionScope,
  formatStoreCollectionScope
};
