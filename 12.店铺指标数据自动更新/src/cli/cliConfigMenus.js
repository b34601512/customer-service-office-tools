const fs = require("fs");
const path = require("path");
const {
  readStoreMetricConfig,
  saveStoreMetricConfig,
  addJdStoreConfig,
  addTmallStoreConfig,
  addPddStoreConfig,
  addDouyinStoreConfig,
  normalizeStoreKeyInput
} = require("../config/storeMetricConfig");
const { DIVIDER, formatDateSelection } = require("./cliDashboard");
const {
  PLATFORM_SCOPE_DEFINITIONS,
  getPlatformScopeDefinition
} = require("../shared/storeCollectionScope");

function isValidCalendarDate(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ""))) return false;
  const [year, month, day] = dateText.split("-").map(Number);
  const parsedDate = new Date(year, month - 1, day);
  return parsedDate.getFullYear() === year &&
    parsedDate.getMonth() === month - 1 && parsedDate.getDate() === day;
}

function saveJdStorePatch(storePatch) {
  return saveStoreMetricConfig({ jd: { stores: [storePatch] } });
}

function saveTmallStorePatch(storePatch) {
  return saveStoreMetricConfig({ tmall: { stores: [storePatch] } });
}

function savePddStorePatch(storePatch) {
  return saveStoreMetricConfig({ pdd: { stores: [storePatch] } });
}

function saveDouyinStorePatch(storePatch) {
  return saveStoreMetricConfig({ douyin: { stores: [storePatch] } });
}

function getPlatformMenuDefinition(platformKey) {
  const platformName = getPlatformScopeDefinition(platformKey)?.platformName;
  if (!platformName) {
    throw new Error(`暂不支持平台：${platformKey || "空"}。`);
  }
  if (platformKey === "jd") {
    return { platformKey, platformName, addStore: addJdStoreConfig, saveStorePatch: saveJdStorePatch };
  }
  if (platformKey === "tmall") {
    return { platformKey, platformName, addStore: addTmallStoreConfig, saveStorePatch: saveTmallStorePatch };
  }
  if (platformKey === "pdd") {
    return { platformKey, platformName, addStore: addPddStoreConfig, saveStorePatch: savePddStorePatch };
  }
  if (platformKey === "douyin") {
    return { platformKey, platformName, addStore: addDouyinStoreConfig, saveStorePatch: saveDouyinStorePatch };
  }
  throw new Error(`暂不支持平台：${platformKey || "空"}。`);
}

function renderPlatformList(terminal, config) {
  terminal.clear();
  terminal.writeLine(terminal.theme.title("店铺管理"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  for (const [platformIndex, definition] of PLATFORM_SCOPE_DEFINITIONS.entries()) {
    const stores = config?.[definition.platformKey]?.stores || [];
    const enabledCount = stores.filter((store) => store.enabled !== false).length;
    terminal.writeLine(`  [${platformIndex + 1}] ${definition.platformName}  ${enabledCount}/${stores.length} 家启用`);
  }
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("  [0] 返回首页");
}

function renderStoreList(terminal, stores, platformName = "京东") {
  terminal.clear();
  terminal.writeLine(terminal.theme.title(`${platformName}店铺管理`));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  for (const [storeIndex, store] of stores.entries()) {
    const enabledText = store.enabled !== false
      ? terminal.theme.success("启用")
      : terminal.theme.muted("停用");
    const accountText = store.username && store.password ? "凭证已配置" : "凭证未完整";
    terminal.writeLine(`  [${storeIndex + 1}] ${store.displayName}  编号=${store.key}  ${enabledText}  ${accountText}`);
  }
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("  [A] 新增店铺    [0] 返回首页");
}

async function editStoreInformation(terminal, platformKey, storeKey) {
  const platformDefinition = getPlatformMenuDefinition(platformKey);
  const currentStore = readStoreMetricConfig()[platformKey].stores.find((store) => store.key === storeKey);
  const displayName = await terminal.promptText(`新店铺名称（回车保留“${currentStore.displayName}”）：`);
  const storePatch = { key: storeKey };
  if (displayName) storePatch.displayName = displayName;
  if (platformKey === "douyin") {
    const platformStoreId = await terminal.promptText(
      `平台店铺ID（回车保留“${currentStore.platformStoreId || "未配置"}”）：`
    );
    const platformStoreName = await terminal.promptText(
      `平台店铺名称（回车保留“${currentStore.platformStoreName || "未配置"}”）：`
    );
    if (platformStoreId) storePatch.platformStoreId = platformStoreId;
    if (platformStoreName) storePatch.platformStoreName = platformStoreName;
  }
  if (Object.keys(storePatch).length > 1) platformDefinition.saveStorePatch(storePatch);
}

async function editStoreAccount(terminal, platformKey, storeKey) {
  const platformDefinition = getPlatformMenuDefinition(platformKey);
  const currentStore = readStoreMetricConfig()[platformKey].stores.find((store) => store.key === storeKey);
  const username = await terminal.promptText(`登录账号（回车保留“${currentStore.username || "未配置"}”）：`);
  const password = await terminal.promptSecret("登录密码（回车保留原密码）：");
  const storePatch = { key: storeKey };
  if (username) storePatch.username = username;
  if (password) storePatch.password = password;
  if (Object.keys(storePatch).length > 1) platformDefinition.saveStorePatch(storePatch);
}

async function editStoreKey(terminal, platformKey, storeKey) {
  const platformDefinition = getPlatformMenuDefinition(platformKey);
  const currentStore = readStoreMetricConfig()[platformKey].stores.find((store) => store.key === storeKey);
  const requestedStoreKey = await terminal.promptText(
    `新店铺编号（可填数字，如 6；回车保留“${currentStore.key}”）：`
  );
  if (!requestedStoreKey) return storeKey;
  const nextStoreKey = normalizeStoreKeyInput(platformKey, requestedStoreKey);
  if (nextStoreKey === currentStore.key) return storeKey;
  platformDefinition.saveStorePatch({ key: currentStore.key, newKey: nextStoreKey });
  return nextStoreKey;
}

async function runSingleStoreMenu(terminal, platformKey, storeKey) {
  const platformDefinition = getPlatformMenuDefinition(platformKey);
  while (true) {
    const store = readStoreMetricConfig()[platformKey].stores.find((candidate) => candidate.key === storeKey);
    if (!store) throw new Error(`找不到${platformDefinition.platformName}店铺：${storeKey}`);
    terminal.clear();
    terminal.writeLine(terminal.theme.title(store.displayName));
    terminal.writeLine(terminal.theme.muted(DIVIDER));
    terminal.writeLine(`店铺编号  ${store.key}`);
    terminal.writeLine(`运行状态  ${store.enabled !== false ? terminal.theme.success("启用") : terminal.theme.muted("停用")}`);
    terminal.writeLine(`登录账号  ${store.username || "未配置"}`);
    terminal.writeLine(`登录密码  ${store.password ? "********（已配置）" : "未配置"}`);
    if (platformKey === "douyin") {
      terminal.writeLine(`平台店铺  ${store.platformStoreName || "未配置"}（ID=${store.platformStoreId || "未配置"}）`);
    }
    terminal.writeLine(terminal.theme.muted(DIVIDER));
    terminal.writeLine("  [1] 修改店铺名称");
    terminal.writeLine("  [2] 修改登录凭证");
    terminal.writeLine("  [3] 修改店铺编号");
    terminal.writeLine(`  [4] ${store.enabled !== false ? "停用" : "启用"}这家店`);
    terminal.writeLine("  [0] 返回店铺列表");
    const answer = await terminal.prompt("请选择：");
    if (answer === "0") return;
    if (answer === "1") await editStoreInformation(terminal, platformKey, storeKey);
    if (answer === "2") await editStoreAccount(terminal, platformKey, storeKey);
    if (answer === "3") storeKey = await editStoreKey(terminal, platformKey, storeKey);
    if (answer === "4") platformDefinition.saveStorePatch({ key: storeKey, enabled: store.enabled === false });
  }
}

async function showPlatformStoreManagementMenu(terminal, platformKey) {
  const platformDefinition = getPlatformMenuDefinition(platformKey);
  while (true) {
    const stores = readStoreMetricConfig()[platformKey].stores;
    renderStoreList(terminal, stores, platformDefinition.platformName);
    const answer = await terminal.prompt("请选择店铺：");
    if (answer === "0") return;
    if (answer === "a") {
      const requestedStoreKey = await terminal.promptText(
        "新增店铺编号（可填数字，如 6；回车自动使用最小可用编号）："
      );
      const addResult = platformDefinition.addStore(readStoreMetricConfig(), requestedStoreKey);
      await runSingleStoreMenu(terminal, platformKey, addResult.newStore.key);
      continue;
    }
    const selectedStoreIndex = Number(answer) - 1;
    if (Number.isInteger(selectedStoreIndex) && stores[selectedStoreIndex]) {
      await runSingleStoreMenu(terminal, platformKey, stores[selectedStoreIndex].key);
    }
  }
}

async function showStoreManagementMenu(terminal) {
  while (true) {
    const config = readStoreMetricConfig();
    renderPlatformList(terminal, config);
    const answer = await terminal.prompt("请选择平台：");
    if (answer === "0") return;
    if (answer === "1") await showPlatformStoreManagementMenu(terminal, "jd");
    if (answer === "2") await showPlatformStoreManagementMenu(terminal, "tmall");
    if (answer === "3") await showPlatformStoreManagementMenu(terminal, "pdd");
    if (answer === "4") await showPlatformStoreManagementMenu(terminal, "douyin");
  }
}

async function showDateSelectionMenu(terminal) {
  while (true) {
    const config = readStoreMetricConfig();
    terminal.clear();
    terminal.writeLine(terminal.theme.title("日期方式"));
    terminal.writeLine(terminal.theme.muted(DIVIDER));
    terminal.writeLine(`当前方式  ${formatDateSelection(config.dateSelection)}`);
    terminal.writeLine();
    terminal.writeLine("  [1] 智能修改 · 自动读取页面最新可用口径");
    terminal.writeLine("  [2] 手动修改 · 指定平台页面快照单日");
    terminal.writeLine("  [0] 返回首页");
    const answer = await terminal.prompt("请选择：");
    if (answer === "0") return;
    if (answer === "1") {
      saveStoreMetricConfig({ dateSelection: { mode: "automatic" } });
      return;
    }
    if (answer === "2") {
      const snapshotDate = await terminal.promptText("请输入日期（YYYY-MM-DD）：");
      if (!isValidCalendarDate(snapshotDate)) {
        terminal.writeLine(terminal.theme.error("日期无效，请按 YYYY-MM-DD 输入真实日期。"));
        await terminal.pause();
        continue;
      }
      saveStoreMetricConfig({ dateSelection: { mode: "manual", manual: { snapshotDate } } });
      return;
    }
  }
}

function normalizeWorkbookPath(rawPath) {
  const trimmedPath = String(rawPath || "").trim().replace(/^"|"$/g, "");
  return trimmedPath ? path.resolve(trimmedPath) : "";
}

function validateWorkbookPath(workbookPath) {
  if (!workbookPath || path.extname(workbookPath).toLowerCase() !== ".xlsx") {
    throw new Error("请选择一个 .xlsx 汇总表。");
  }
  if (!fs.existsSync(workbookPath) || !fs.statSync(workbookPath).isFile()) {
    throw new Error(`汇总表不存在：${workbookPath}`);
  }
  return workbookPath;
}

async function showWorkbookSettingsMenu(terminal) {
  const config = readStoreMetricConfig();
  terminal.clear();
  terminal.writeLine(terminal.theme.title("汇总表设置"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("当前文件：");
  terminal.writeLine(config.workbook.path);
  terminal.writeLine();
  terminal.writeLine("直接回车可保留当前文件。路径可以从资源管理器复制后粘贴。");
  const rawPath = await terminal.promptText("新汇总表路径：");
  if (!rawPath) return;
  const workbookPath = validateWorkbookPath(normalizeWorkbookPath(rawPath));
  saveStoreMetricConfig({ workbook: { path: workbookPath } });
}

module.exports = {
  isValidCalendarDate,
  saveJdStorePatch,
  saveTmallStorePatch,
  savePddStorePatch,
  saveDouyinStorePatch,
  getPlatformMenuDefinition,
  renderPlatformList,
  normalizeWorkbookPath,
  validateWorkbookPath,
  editStoreKey,
  showPlatformStoreManagementMenu,
  showStoreManagementMenu,
  showDateSelectionMenu,
  showWorkbookSettingsMenu
};
