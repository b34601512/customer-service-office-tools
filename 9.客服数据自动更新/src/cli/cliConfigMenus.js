const fs = require("fs");
const path = require("path");
const { readProjectConfig, saveProjectConfig } = require("../config/projectConfigServiceParts/projectConfigPersistence");
const { listReportModules } = require("../config/reportModuleDefinitions");
const { createManualExportDateRangeConfig } = require("../shared/exportDateRange");
const { DIVIDER, formatGlobalDateMode } = require("./cliDashboard");
const { PLATFORM_KEYS, findStore, updateProjectConfig, addPlatformStore, patchPlatformStore, patchReportProfile, applyStoreCustomDateRange, restoreStoreGlobalDateRange, normalizeUserPath } = require("./cliProjectConfig");
const { PLATFORM_META } = require("./cliConstants");

function isValidCalendarDate(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ""))) return false;
  const [year, month, day] = dateText.split("-").map(Number);
  const parsedDate = new Date(year, month - 1, day);
  return parsedDate.getFullYear() === year && parsedDate.getMonth() === month - 1 && parsedDate.getDate() === day;
}

function requireValidDateRange(startDate, endDate) {
  if (!isValidCalendarDate(startDate) || !isValidCalendarDate(endDate)) throw new Error("日期无效，请按 YYYY-MM-DD 输入真实日期。");
  if (startDate > endDate) throw new Error("开始日期不能晚于结束日期。");
}

function renderPlatformList(terminal, projectConfig) {
  terminal.clear(); terminal.writeLine(terminal.theme.title("平台/店铺管理")); terminal.writeLine(terminal.theme.muted(DIVIDER));
  PLATFORM_KEYS.forEach((platformKey, platformIndex) => {
    const stores = projectConfig[platformKey]?.stores || [];
    const enabledCount = stores.filter((store) => store.includedInSummary !== false).length;
    terminal.writeLine(`  [${platformIndex + 1}] ${PLATFORM_META[platformKey].label}  ${enabledCount}/${stores.length} 家启用`);
  });
  terminal.writeLine(terminal.theme.muted(DIVIDER)); terminal.writeLine("  [0] 返回首页");
}

async function editStoreBasicInformation(terminal, platformKey, storeKey) {
  const store = findStore(readProjectConfig(), platformKey, storeKey);
  const displayName = await terminal.promptText(`店铺名称（回车保留“${store.displayName}”）：`);
  const platformStoreId = platformKey === "douyin" ? await terminal.promptText(`抖店ID（回车保留“${store.platformStoreId || "未配置"}”）：`) : "";
  const platformStoreName = platformKey === "douyin" ? await terminal.promptText(`抖店名称（回车保留“${store.platformStoreName || "未配置"}”）：`) : "";
  const patch = {};
  if (displayName) patch.displayName = displayName;
  if (platformStoreId) patch.platformStoreId = platformStoreId;
  if (platformStoreName) patch.platformStoreName = platformStoreName;
  if (Object.keys(patch).length) patchPlatformStore(platformKey, storeKey, patch);
}

async function editStoreCredentials(terminal, platformKey, storeKey) {
  const store = findStore(readProjectConfig(), platformKey, storeKey);
  const username = await terminal.promptText(`登录账号（回车保留“${store.username || "未配置"}”）：`);
  const password = await terminal.promptSecret("登录密码（回车保留原密码）：");
  const patch = {};
  if (username) patch.username = username;
  if (password) patch.password = password;
  if (Object.keys(patch).length) patchPlatformStore(platformKey, storeKey, patch);
}

async function editStoreDownloadDirectory(terminal, platformKey, storeKey) {
  const store = findStore(readProjectConfig(), platformKey, storeKey);
  const value = await terminal.promptText(`下载目录（回车保留“${store.downloadDir}”）：`);
  if (value) patchPlatformStore(platformKey, storeKey, { downloadDir: normalizeUserPath(value) });
}

async function editStoreDateRange(terminal, platformKey, storeKey) {
  const store = findStore(readProjectConfig(), platformKey, storeKey);
  terminal.clear(); terminal.writeLine(terminal.theme.title(`${store.displayName} · 统计日期`)); terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(`当前  ${store.usesGlobalExportDateRange !== false ? "跟随全局" : "单店自定义"} · ${store.exportDateRange.start.customDate} 至 ${store.exportDateRange.end.customDate}`);
  terminal.writeLine("  [1] 跟随全局日期"); terminal.writeLine("  [2] 设置单店日期"); terminal.writeLine("  [0] 返回");
  const answer = await terminal.prompt("请选择：");
  if (answer === "1") restoreStoreGlobalDateRange(platformKey, storeKey);
  if (answer === "2") {
    const startDate = await terminal.promptText("开始日期（YYYY-MM-DD）：");
    const endDate = await terminal.promptText("结束日期（YYYY-MM-DD）：");
    requireValidDateRange(startDate, endDate);
    applyStoreCustomDateRange(platformKey, storeKey, startDate, endDate);
  }
}

async function showStoreReportMenu(terminal, platformKey, storeKey) {
  while (true) {
    const store = findStore(readProjectConfig(), platformKey, storeKey);
    const reports = listReportModules().filter((moduleItem) => store.reportProfiles?.[moduleItem.key]);
    terminal.clear(); terminal.writeLine(terminal.theme.title(`${store.displayName} · 客服指标`)); terminal.writeLine(terminal.theme.muted(DIVIDER));
    reports.forEach((moduleItem, index) => {
      const profile = store.reportProfiles[moduleItem.key];
      terminal.writeLine(`  [${index + 1}] ${moduleItem.displayName}  ${profile.enabled !== false ? terminal.theme.success("启用") : terminal.theme.muted("停用")}`);
      terminal.writeLine(`      来源：${profile.siteUrl || "平台固定规则"}`);
    });
    terminal.writeLine(terminal.theme.muted(DIVIDER)); terminal.writeLine("选择指标可切换启用状态；[0] 返回");
    const answer = await terminal.prompt("请选择：");
    if (answer === "0") return;
    const moduleItem = reports[Number(answer) - 1];
    if (moduleItem) {
      const profile = store.reportProfiles[moduleItem.key];
      patchReportProfile(platformKey, storeKey, moduleItem.key, { enabled: profile.enabled === false });
    }
  }
}

async function runSingleStoreMenu(terminal, platformKey, storeKey) {
  while (true) {
    const store = findStore(readProjectConfig(), platformKey, storeKey);
    if (!store) throw new Error(`找不到店铺：${storeKey}`);
    const enabledReportCount = Object.values(store.reportProfiles || {}).filter((profile) => profile.enabled !== false).length;
    terminal.clear(); terminal.writeLine(terminal.theme.title(`${PLATFORM_META[platformKey].label} · ${store.displayName}`)); terminal.writeLine(terminal.theme.muted(DIVIDER));
    terminal.writeLine(`编号      ${store.key}`); terminal.writeLine(`汇总状态  ${store.includedInSummary !== false ? terminal.theme.success("启用") : terminal.theme.muted("停用")}`);
    terminal.writeLine(`登录账号  ${store.username || "未配置"}`); terminal.writeLine(`登录密码  ${store.password ? "********（已配置）" : "未配置"}`);
    terminal.writeLine(`客服指标  ${enabledReportCount} 项启用`);
    terminal.writeLine(`统计日期  ${store.usesGlobalExportDateRange !== false ? "跟随全局" : "单店自定义"} · ${store.exportDateRange.start.customDate} 至 ${store.exportDateRange.end.customDate}`);
    terminal.writeLine(`下载目录  ${store.downloadDir}`); terminal.writeLine(terminal.theme.muted(DIVIDER));
    terminal.writeLine("  [1] 店铺身份      [2] 登录凭证      [3] 启用/停用");
    terminal.writeLine("  [4] 统计日期      [5] 客服指标      [6] 下载目录");
    terminal.writeLine("  [0] 返回");
    const answer = await terminal.prompt("请选择：");
    if (answer === "0") return;
    if (answer === "1") await editStoreBasicInformation(terminal, platformKey, storeKey);
    if (answer === "2") await editStoreCredentials(terminal, platformKey, storeKey);
    if (answer === "3") patchPlatformStore(platformKey, storeKey, { includedInSummary: store.includedInSummary === false });
    if (answer === "4") await editStoreDateRange(terminal, platformKey, storeKey);
    if (answer === "5") await showStoreReportMenu(terminal, platformKey, storeKey);
    if (answer === "6") await editStoreDownloadDirectory(terminal, platformKey, storeKey);
  }
}

async function showPlatformStoreMenu(terminal, platformKey) {
  while (true) {
    const stores = readProjectConfig()[platformKey].stores;
    terminal.clear(); terminal.writeLine(terminal.theme.title(`${PLATFORM_META[platformKey].label}店铺`)); terminal.writeLine(terminal.theme.muted(DIVIDER));
    stores.forEach((store, index) => terminal.writeLine(`  [${index + 1}] ${store.displayName}  ${store.includedInSummary !== false ? terminal.theme.success("启用") : terminal.theme.muted("停用")}  ${store.username && store.password ? "凭证已配置" : "凭证未完整"}`));
    terminal.writeLine(terminal.theme.muted(DIVIDER)); terminal.writeLine("  [A] 新增店铺    [0] 返回平台列表");
    const answer = await terminal.prompt("请选择店铺：");
    if (answer === "0") return;
    if (answer === "a") {
      const result = addPlatformStore(platformKey);
      await runSingleStoreMenu(terminal, platformKey, result.newStoreKey);
      continue;
    }
    const selectedStore = stores[Number(answer) - 1];
    if (selectedStore) await runSingleStoreMenu(terminal, platformKey, selectedStore.key);
  }
}

async function showStoreManagementMenu(terminal) {
  while (true) {
    const projectConfig = readProjectConfig(); renderPlatformList(terminal, projectConfig);
    const answer = await terminal.prompt("请选择平台：");
    if (answer === "0") return;
    const platformKey = PLATFORM_KEYS[Number(answer) - 1];
    if (platformKey) await showPlatformStoreMenu(terminal, platformKey);
  }
}

async function showDateSelectionMenu(terminal) {
  while (true) {
    const projectConfig = readProjectConfig();
    terminal.clear(); terminal.writeLine(terminal.theme.title("全店日期方式")); terminal.writeLine(terminal.theme.muted(DIVIDER));
    terminal.writeLine(`当前  ${formatGlobalDateMode(projectConfig)}`); terminal.writeLine("切换全局日期会覆盖全部店铺，并恢复为跟随全局。");
    terminal.writeLine("  [1] 智能模式（本月1号起，每次启动自动更新）"); terminal.writeLine("  [2] 手动日期范围"); terminal.writeLine("  [0] 返回首页");
    const answer = await terminal.prompt("请选择：");
    if (answer === "0") return;
    if (answer === "1") {
      const delayText = await terminal.promptText(`数据延迟天数（当前 ${projectConfig.globalDefaults.exportDateAutomation.endDateDelayDayCount}）：`);
      const delayDayCount = delayText ? Number(delayText) : projectConfig.globalDefaults.exportDateAutomation.endDateDelayDayCount;
      projectConfig.globalDefaults.exportDateMode = "automatic";
      projectConfig.globalDefaults.exportDateAutomation = { endDateDelayDayCount: delayDayCount };
      saveProjectConfig(projectConfig, { applyGlobalExportDateRangeToAllStores: true, requestedGlobalExportDateMode: "automatic" });
      return;
    }
    if (answer === "2") {
      const startDate = await terminal.promptText("开始日期（YYYY-MM-DD）：");
      const endDate = await terminal.promptText("结束日期（YYYY-MM-DD）：");
      requireValidDateRange(startDate, endDate);
      projectConfig.globalDefaults.exportDateMode = "manual";
      projectConfig.globalDefaults.exportDateRange = createManualExportDateRangeConfig(startDate, endDate);
      saveProjectConfig(projectConfig, { applyGlobalExportDateRangeToAllStores: true, requestedGlobalExportDateMode: "manual" });
      return;
    }
  }
}

async function showWorkbookSettingsMenu(terminal) {
  const projectConfig = readProjectConfig();
  terminal.clear(); terminal.writeLine(terminal.theme.title("汇总表设置")); terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(`当前文件：${projectConfig.workbook.path || "未设置"}`); terminal.writeLine("直接回车保留；可从资源管理器复制路径。 ");
  const rawPath = await terminal.promptText("新汇总表路径：");
  if (!rawPath) return;
  const workbookPath = normalizeUserPath(rawPath);
  if (path.extname(workbookPath).toLowerCase() !== ".xlsx" || !fs.existsSync(workbookPath) || !fs.statSync(workbookPath).isFile()) throw new Error(`请选择已存在的 .xlsx 汇总表：${workbookPath}`);
  updateProjectConfig((draftConfig) => { draftConfig.workbook.path = workbookPath; });
}

async function showDownloadRootSettingsMenu(terminal) {
  const projectConfig = readProjectConfig();
  terminal.clear(); terminal.writeLine(terminal.theme.title("下载根目录")); terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(`当前目录：${projectConfig.globalDefaults.downloadRootDir}`);
  const rawPath = await terminal.promptText("新根目录（回车保留）：");
  if (!rawPath) return;
  projectConfig.globalDefaults.downloadRootDir = normalizeUserPath(rawPath);
  saveProjectConfig(projectConfig, { applyGlobalDownloadRootToAllStores: true });
}

module.exports = { isValidCalendarDate, requireValidDateRange, showStoreManagementMenu, showDateSelectionMenu, showWorkbookSettingsMenu, showDownloadRootSettingsMenu };
