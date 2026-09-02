const { readStoreMetricConfig, listEnabledStoreTasks } = require("../config/storeMetricConfig");
const { DIVIDER } = require("./cliDashboard");
const {
  PLATFORM_SCOPE_DEFINITIONS,
  getPlatformScopeDefinition,
  normalizeStoreCollectionScope,
  getStoreTaskPlatformKey
} = require("../shared/storeCollectionScope");

function renderCollectionScopeMenu(terminal) {
  terminal.clear();
  terminal.writeLine(terminal.theme.title("强制重新采集范围"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("  [1] 全部店铺");
  terminal.writeLine("  [2] 某个平台");
  terminal.writeLine("  [3] 某一家店");
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("  [0] 返回首页");
}

function renderPlatformScopeMenu(terminal) {
  terminal.clear();
  terminal.writeLine(terminal.theme.title("选择平台"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  for (const [platformIndex, definition] of PLATFORM_SCOPE_DEFINITIONS.entries()) {
    terminal.writeLine(`  [${platformIndex + 1}] ${definition.platformName}`);
  }
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("  [0] 返回上一级");
}

function renderStoreScopeMenu(terminal, stores) {
  terminal.clear();
  terminal.writeLine(terminal.theme.title("选择店铺"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  for (const [storeIndex, store] of stores.entries()) {
    const platformDefinition = getPlatformScopeDefinition(getStoreTaskPlatformKey(store));
    const platformName = platformDefinition?.platformName || getStoreTaskPlatformKey(store);
    terminal.writeLine(
      `  [${storeIndex + 1}] ${platformName} · ${store.displayName}  编号=${store.key}`
    );
  }
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("  [0] 返回上一级");
}

async function choosePlatformCollectionScope(terminal) {
  while (true) {
    renderPlatformScopeMenu(terminal);
    const answer = await terminal.prompt("请选择平台：");
    if (answer === "0") return null;
    const selectedPlatform = PLATFORM_SCOPE_DEFINITIONS[Number(answer) - 1];
    if (selectedPlatform) return normalizeStoreCollectionScope({
      type: "platform",
      platformKey: selectedPlatform.platformKey
    });
  }
}

async function chooseStoreCollectionScope(terminal, config) {
  const stores = listEnabledStoreTasks(config);
  if (!stores.length) {
    terminal.writeLine(terminal.theme.error("没有启用的店铺，请先在店铺管理中启用至少一家店。"));
    await terminal.pause();
    return null;
  }
  while (true) {
    renderStoreScopeMenu(terminal, stores);
    const answer = await terminal.prompt("请选择店铺：");
    if (answer === "0") return null;
    const selectedStore = stores[Number(answer) - 1];
    if (selectedStore) return normalizeStoreCollectionScope({
      type: "store",
      platformKey: getStoreTaskPlatformKey(selectedStore),
      storeKey: selectedStore.key
    });
  }
}

async function showForceCollectionScopeMenu(terminal, config = readStoreMetricConfig()) {
  while (true) {
    renderCollectionScopeMenu(terminal);
    const answer = await terminal.prompt("请选择强制采集范围：");
    if (answer === "0") return null;
    if (answer === "1") return normalizeStoreCollectionScope({ type: "all" });
    if (answer === "2") {
      const platformScope = await choosePlatformCollectionScope(terminal);
      if (platformScope) return platformScope;
    }
    if (answer === "3") {
      const storeScope = await chooseStoreCollectionScope(terminal, config);
      if (storeScope) return storeScope;
    }
  }
}

module.exports = {
  renderCollectionScopeMenu,
  renderPlatformScopeMenu,
  renderStoreScopeMenu,
  choosePlatformCollectionScope,
  chooseStoreCollectionScope,
  showForceCollectionScopeMenu
};
