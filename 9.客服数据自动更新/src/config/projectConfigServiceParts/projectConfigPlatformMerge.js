// 该文件只负责把平台和店铺输入合并到默认配置。
const { normalizeString } = require("./projectConfigValuePrimitives");

function mergeStoresWithDefaults(defaultStores, incomingStores) {
  // 该函数只按店铺标识合并默认店铺和用户店铺。
  const safeIncomingStores = Array.isArray(incomingStores) ? incomingStores : [];
  const incomingStoreMap = new Map(
    safeIncomingStores.map((store) => [normalizeString(store?.key), store]).filter((item) => item[0])
  );

  const mergedDefaultStores = defaultStores.map((defaultStore) => ({
    ...defaultStore,
    ...(incomingStoreMap.get(defaultStore.key) || {})
  }));

  const extraStores = safeIncomingStores.filter((store) => {
    const storeKey = normalizeString(store?.key);
    return storeKey && !defaultStores.some((defaultStore) => defaultStore.key === storeKey);
  });

  return [...mergedDefaultStores, ...extraStores];
}

function mergePlatformWithDefaults(defaultPlatform, incomingPlatform) {
  // 该函数只合并单个平台的店铺清单。
  return {
    stores: mergeStoresWithDefaults(defaultPlatform.stores, incomingPlatform?.stores)
  };
}

module.exports = {
  mergeStoresWithDefaults,
  mergePlatformWithDefaults
};
