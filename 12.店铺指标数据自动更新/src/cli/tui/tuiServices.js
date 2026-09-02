// TUI 服务层：页面唯一数据入口，把 #12 业务模块收口成页面可消费的快照 API。
// 每个 TUI 实例持有自己的 stateStore（createControlCenterStateStore 是每实例 store，
// 与 #9 的模块级单例不同），runTask 把同一实例交给 runConfiguredStoresTask。
const fs = require("fs");
const { createControlCenterStateStore } = require("../../controlCenter/controlCenterState");
const { runConfiguredStoresTask } = require("../../controlCenter/controlCenterTask");
const {
  readStoreMetricConfig,
  saveStoreMetricConfig,
  listEnabledStoreTasks,
  normalizeStoreKeyInput
} = require("../../config/storeMetricConfig");
const { readTaskHistory } = require("../../shared/taskHistoryParts/taskHistoryStore");
const { syncDataSourceToKdocs } = require("../../kdocsSync/syncDataSourceToKdocs");
const {
  isKdocsSyncConfigured,
  requireValidKdocsDocumentUrl,
  requireValidKdocsWebhookUrl
} = require("../../kdocsSync/kdocsSyncSettings");
const {
  getPlatformMenuDefinition,
  isValidCalendarDate,
  normalizeWorkbookPath,
  validateWorkbookPath
} = require("../cliConfigMenus");
const { openRecentEvidenceFolder } = require("../cliEvidenceMenu");
const { airScriptTemplatePath } = require("../cliKdocsSyncMenu");
const {
  revealLocalPath,
  openLocalFile,
  openExternalUrl,
  resolveWorkbookFolder
} = require("../../controlCenter/localFileApiParts/windowsLocalFileActions");

function createTuiServices({ stateStore, options = {} } = {}) {
  const store = stateStore || createControlCenterStateStore();
  const services = {
    getState: () => store.read(),
    patchState: (patch) => store.update(patch),
    subscribeState: (listener) => store.subscribe(listener),

    readConfig: () => readStoreMetricConfig(),
    listEnabledStores: (config) => listEnabledStoreTasks(config || readStoreMetricConfig()),
    readTaskHistory: () => readTaskHistory(),

    // 运行链路：统一交给 runConfiguredStoresTask(store, ...)，同一实例保证订阅能看到进度。
    runTask: ({ forceRecollect = false, collectionScope } = {}) =>
      runConfiguredStoresTask(store, { forceRecollect, collectionScope }),

    isKdocsSyncConfigured: (config) => isKdocsSyncConfigured(config?.kdocsDataSourceSync),
    runKdocsDataSourceSync: () => syncDataSourceToKdocs({ projectConfig: readStoreMetricConfig() }),
    saveKdocsSyncSettings: (nextSettings) =>
      saveStoreMetricConfig({ kdocsDataSourceSync: nextSettings }),
    validateKdocsDocumentUrl: (url) => requireValidKdocsDocumentUrl(url),
    validateKdocsWebhookUrl: (url) => requireValidKdocsWebhookUrl(url),

    getPlatformMenuDefinition: (platformKey) => getPlatformMenuDefinition(platformKey),
    saveStorePatch: (platformKey, storePatch) =>
      getPlatformMenuDefinition(platformKey).saveStorePatch(storePatch),
    addStoreConfig: (platformKey, requestedStoreKey) =>
      getPlatformMenuDefinition(platformKey).addStore(readStoreMetricConfig(), requestedStoreKey),
    normalizeStoreKeyInput: (platformKey, rawStoreKey) =>
      normalizeStoreKeyInput(platformKey, rawStoreKey),

    isValidCalendarDate: (dateText) => isValidCalendarDate(dateText),
    saveDateSelection: (dateSelection) => saveStoreMetricConfig({ dateSelection }),
    saveWorkbookPath: (workbookPath) => saveStoreMetricConfig({ workbook: { path: workbookPath } }),
    normalizeWorkbookPath: (rawPath) => normalizeWorkbookPath(rawPath),
    validateWorkbookPath: (workbookPath) => validateWorkbookPath(workbookPath),

    openRecentEvidenceFolder: () => openRecentEvidenceFolder(),
    openWorkbookDirectory: () => {
      const config = readStoreMetricConfig();
      return revealLocalPath(resolveWorkbookFolder(config.workbook.path));
    },
    openKdocsScript: () => {
      if (!fs.existsSync(airScriptTemplatePath)) {
        throw new Error(`找不到 AirScript 脚本文件：${airScriptTemplatePath}`);
      }
      return openLocalFile(airScriptTemplatePath);
    },
    openKdocsDocument: () => {
      const documentUrl = requireValidKdocsDocumentUrl(
        readStoreMetricConfig().kdocsDataSourceSync?.documentUrl
      );
      return openExternalUrl(documentUrl);
    },
    openUrl: (targetUrl) => openExternalUrl(targetUrl),

    shutdown: () => require("../../engine/chromeSession").closeManagedChrome()
  };
  // options 覆盖：测试注入假服务、特殊环境替换实现。
  return Object.assign(services, options);
}

module.exports = {
  createTuiServices
};