// TUI 服务层：页面只通过这里读写配置和触发动作。
// 重量级依赖（playwright/xlsx 链路）全部按需 require，保证 TUI 首屏秒开。
const path = require("path");
const fs = require("fs");
const appConfig = require("../../config/appConfig");
const { readProjectConfig } = require("../../config/projectConfigServiceParts/projectConfigPersistence");
const { buildConfiguredSummaryTasks } = require("../../controlCenter/summaryTaskPlanner");
const {
  getControlCenterState,
  patchControlCenterState,
  subscribeControlCenterState
} = require("../../controlCenter/controlCenterState");
const { revealLocalPath, openLocalFile, openExternalUrl } = require("../../controlCenter/localFileApiParts/windowsLocalFileActions");
const { updateProjectConfig, findStore, patchPlatformStore } = require("../cliProjectConfig");
const { scheduleStartupCleanup, ensureStartupCleanupDone } = require("../cliStartupCleanup");

function createTuiServices(options = {}) {
  return {
    readConfig: options.readConfig || readProjectConfig,
    buildTasks: options.buildTasks || buildConfiguredSummaryTasks,
    getState: options.getState || getControlCenterState,
    patchState: options.patchState || patchControlCenterState,
    subscribeState: options.subscribeState || subscribeControlCenterState,
    openPath: (targetPath) => revealLocalPath(targetPath),
    openFile: (targetPath) => openLocalFile(targetPath),
    openUrl: (targetUrl) => openExternalUrl(targetUrl),
    ensureStartupCleanupDone,

    // 汇总执行链路会拉起 playwright，只在真正运行时才加载。
    async runSummaryTask({ selectedSummaryTaskIds, forceRedownload } = {}) {
      await ensureStartupCleanupDone();
      const { runConfiguredSummaryTask } = require("../cliSummaryTask");
      return runConfiguredSummaryTask({ selectedSummaryTaskIds, forceRedownload });
    },

    // 金山同步链路会加载 xlsx，同样按需加载。
    async runKdocsDataDetailSync() {
      const { syncDataDetailToKdocs } = require("../../kdocsSync/syncDataDetailToKdocs");
      const syncResult = await syncDataDetailToKdocs({ projectConfig: readProjectConfig() });
      patchControlCenterState({
        lastAction: `金山文档同步完成：在线真实回读${syncResult.remoteDataRowCount}行`,
        lastError: ""
      });
      return syncResult;
    },
    async runKdocsPivotEndDateFilterUpdate(filterDate) {
      const { updateKdocsPivotEndDateFilter } = require("../../kdocsSync/updateKdocsPivotEndDateFilter");
      const updateResult = await updateKdocsPivotEndDateFilter({
        projectConfig: readProjectConfig(),
        filterDate
      });
      const resultText = updateResult.failedPivotTableCount
        ? `透视筛选未全部完成（目标${updateResult.filterDate}）：成功${updateResult.successfulPivotTableCount}/${updateResult.pivotTableCount}个`
        : `透视筛选已设为${updateResult.filterDate}：成功${updateResult.successfulPivotTableCount}/${updateResult.pivotTableCount}个`;
      patchControlCenterState({
        lastAction: resultText,
        lastError: updateResult.failedPivotTableCount ? `有${updateResult.failedPivotTableCount}个透视表失败` : ""
      });
      return updateResult;
    },
    async runKdocsCustomerServiceNameFilterReapply() {
      const { reapplyKdocsCustomerServiceNameFilter } = require("../../kdocsSync/reapplyKdocsCustomerServiceNameFilter");
      const updateResult = await reapplyKdocsCustomerServiceNameFilter({ projectConfig: readProjectConfig() });
      const resultText = `客服姓名勾选已原样确认：成功${updateResult.successfulPivotTableCount}/${updateResult.pivotTableCount}个透视表`;
      patchControlCenterState({
        lastAction: resultText,
        lastError: updateResult.failedPivotTableCount ? `有${updateResult.failedPivotTableCount}个透视表失败` : ""
      });
      return updateResult;
    },

    // 更新已有明细岗位（xlsx 链路，按需加载）。
    async refreshExistingPersonRoles() {
      const { refreshDataDetailPersonRoles } = require("../../controlCenter/controlCenterPersonRoleRefresh");
      const result = await refreshDataDetailPersonRoles(readProjectConfig());
      patchControlCenterState({
        lastAction: `已有明细岗位已更新${result?.updatedRowCount !== undefined ? `：${result.updatedRowCount} 行` : ""}`,
        lastError: ""
      });
      return result;
    },

    // 常用路径。
    openSummaryEvidenceDirectory() {
      const evidenceRoot = path.join(appConfig.projectRoot, "runtime", "evidence", "summary");
      fs.mkdirSync(evidenceRoot, { recursive: true });
      return revealLocalPath(evidenceRoot);
    },
    resolveSourceDownloadRoot(projectConfig) {
      return (
        String(projectConfig?.globalDefaults?.downloadRootDir || "").trim() ||
        appConfig.runtime.output.downloadsRoot
      );
    },
    openWorkbookDirectory() {
      const workbookPath = readProjectConfig().workbook.path;
      const normalizedPath = String(workbookPath || "").trim();
      let targetDirectory = process.cwd();
      if (normalizedPath && fs.existsSync(normalizedPath)) {
        targetDirectory = fs.statSync(normalizedPath).isDirectory()
          ? normalizedPath
          : path.dirname(normalizedPath);
      } else if (normalizedPath && fs.existsSync(path.dirname(normalizedPath))) {
        targetDirectory = path.dirname(normalizedPath);
      }
      return revealLocalPath(targetDirectory);
    },
    async openDownloadRootDirectory() {
      const downloadRootDir = readProjectConfig().globalDefaults.downloadRootDir;
      fs.mkdirSync(downloadRootDir, { recursive: true });
      await revealLocalPath(downloadRootDir);
    },
    openKdocsScript(scriptName) {
      const scriptPath = path.join(appConfig.projectRoot, "src", "kdocsSync", scriptName);
      if (!fs.existsSync(scriptPath)) {
        throw new Error(`找不到 AirScript 脚本文件：${scriptPath}`);
      }
      return openLocalFile(scriptPath);
    },

    // 配置写入辅助。
    updateProjectConfig,
    findStore,
    patchPlatformStore
  };
}

module.exports = { createTuiServices };
