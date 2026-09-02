const fs = require("fs");
const { runManagedOpenWindowEngine } = require("../../../shared/managedOpenWindowEngine");
const {
  createStoreMetricEvidenceDirectory,
  buildEvidenceFilePath,
  mergeEvidenceFiles,
  listExistingEvidenceFiles
} = require("../../../shared/evidenceFiles");
const { startJdLoginAssist } = require("../jdLoginAssist");
const {
  connectToChrome,
  disconnectFromChrome,
  closeManagedChrome
} = require("../../../engine/chromeSession");
const { collectJdShopStarMetrics } = require("./jdShopStarMetricCollector");
const { collectJdNegativeServiceMetrics } = require("./jdNegativeServiceMetricCollector");
const { collectJdComplianceMetrics } = require("./jdComplianceMetricCollector");
const { writeStoreMetricRecords } = require("../../../summaryData/storeMetricWorkbookWriter");
const { retiredDataSourcePages } = require("../../../summaryData/storeMetricDataSourceSchema");
const { notifyProgress, captureFailurePageEvidence } = require("../../storeMetricsShared");

function createStoreMetricResolvedConfig(store) {
  const activeStore = {
    ...store,
    siteUrl: store.sources.shopStar,
    activeReportKey: "store_metrics",
    activeReportDisplayName: "京东店铺考核指标"
  };
  return {
    reportKey: "store_metrics",
    activeStore
  };
}

async function collectPageWithEvidence(browserContext, evidenceDirectory, evidenceName, evidenceFiles, collector) {
  const page = await browserContext.newPage();
  try {
    const records = await collector(page);
    const successEvidencePath = buildEvidenceFilePath({
      evidenceDirectory,
      evidenceLabel: evidenceName,
      resultLabel: "读取成功",
      fileExtension: "png"
    });
    await page.screenshot({ path: successEvidencePath, fullPage: true }).catch(() => {});
    if (fs.existsSync(successEvidencePath)) {
      evidenceFiles.push({ label: `${evidenceName}读取凭证`, filePath: successEvidencePath });
    }
    return records;
  } catch (error) {
    const evidencePath = buildEvidenceFilePath({
      evidenceDirectory,
      evidenceLabel: evidenceName,
      resultLabel: "读取失败",
      fileExtension: "png"
    });
    await page.screenshot({ path: evidencePath, fullPage: true }).catch(() => {});
    if (fs.existsSync(evidencePath)) {
      evidenceFiles.push({ label: `${evidenceName}失败现场`, filePath: evidencePath });
    }
    error.evidenceDirectory = evidenceDirectory;
    error.evidenceFiles = mergeEvidenceFiles(error.evidenceFiles, evidenceFiles);
    error.evidencePath = evidencePath;
    throw error;
  } finally {
    await page.close().catch(() => {});
  }
}

async function collectPageMetricsFromLoggedBrowser(store, dateSelection, evidenceDirectory, evidenceFiles, onProgress) {
  notifyProgress(onProgress, "读取页面指标", "并行读取店铺星级、违规服务分析和店铺合规");
  const browser = await connectToChrome();
  try {
    const browserContext = browser.contexts()[0];
    if (!browserContext) throw new Error("京东浏览器没有可用上下文。");
    const [shopStarResult, negativeServiceResult, complianceResult] = await Promise.all([
      collectPageWithEvidence(browserContext, evidenceDirectory, "店铺星级", evidenceFiles, (page) =>
        collectJdShopStarMetrics(page, store, dateSelection)),
      collectPageWithEvidence(browserContext, evidenceDirectory, "违规服务分析", evidenceFiles, (page) =>
        collectJdNegativeServiceMetrics(page, store)),
      collectPageWithEvidence(browserContext, evidenceDirectory, "店铺合规", evidenceFiles, (page) =>
        collectJdComplianceMetrics(page, store))
    ]);
    return {
      records: [
        ...shopStarResult.records,
        ...negativeServiceResult.records,
        ...complianceResult.records
      ],
      skipped: [
        ...(shopStarResult.skipped || []),
        ...(negativeServiceResult.skipped || []),
        ...(complianceResult.skipped || [])
      ]
    };
  } finally {
    await disconnectFromChrome(browser, "京东店铺指标页面读取完成，断开自动化连接");
  }
}

function shouldKeepBrowserForManualLogin(error) {
  return /验证码|滑块|安全验证|等待京东登录成功超时|登录辅助超时|关闭京东遮挡弹窗失败/.test(String(error?.message || error));
}

async function collectAndWriteJdStoreMetrics({ config, store, dateSelection, onProgress }) {
  const resolvedConfig = createStoreMetricResolvedConfig(store);
  const evidenceDirectory = createStoreMetricEvidenceDirectory({
    platformKey: store.platformKey || "jd",
    storeDisplayName: store.displayName,
    storeKey: store.key
  });
  const evidenceFiles = [];
  let keepBrowserOpen = false;
  try {
    notifyProgress(onProgress, `打开${store.displayName}`, "正在启动独立浏览器并自动登录");
    await runManagedOpenWindowEngine({
      platformKey: "jd",
      storeConfig: resolvedConfig.activeStore,
      actionName: "店铺指标打开后台页面",
      moduleName: "店铺指标",
      missingOpenUrlMessage: `${store.displayName}缺少店铺考核页面地址。`
    });
    await startJdLoginAssist({
      forceRestart: true,
      reportKey: "store_metrics",
      resolvedConfig,
      onLoginReady(loginState) {
        notifyProgress(onProgress, "京东登录成功", `店铺=${loginState.displayName}`);
      },
      onManualVerification(verificationState) {
        notifyProgress(
          onProgress,
          "等待人工验证",
          `${verificationState.displayName}需要${verificationState.reason}，请在打开的京东窗口完成后等待程序继续。`
        );
      }
    });

    const pageResult = await collectPageMetricsFromLoggedBrowser(
      store,
      dateSelection,
      evidenceDirectory,
      evidenceFiles,
      onProgress
    );
    const pageRecords = pageResult.records;
    const skippedMetrics = pageResult.skipped || [];
    notifyProgress(onProgress, "写入统一数据源", `本次共 ${pageRecords.length} 条店铺考核指标${skippedMetrics.length ? `，${skippedMetrics.length} 项未读取已跳过` : ""}`);
    const writeResult = await writeStoreMetricRecords({
      workbookPath: config.workbook.path,
      records: pageRecords,
      retiredSourcePages: retiredDataSourcePages
    });
    notifyProgress(
      onProgress,
      "完成",
      `写入 ${writeResult.writtenCount} 条，替换 ${writeResult.replacedCount} 条，清理 ${writeResult.removedCount} 条旧客服数据${skippedMetrics.length ? `，跳过 ${skippedMetrics.length} 项未读取指标` : ""}`
    );
    return {
      workbookPath: config.workbook.path,
      evidenceDirectory,
      evidenceFiles: listExistingEvidenceFiles(evidenceFiles),
      metricCount: pageRecords.length,
      skippedMetrics,
      recordKeys: pageRecords.map((record) => record.recordKey).filter(Boolean),
      records: pageRecords,
      writeResult
    };
  } catch (error) {
    const browserEvidenceFiles = await captureFailurePageEvidence(evidenceDirectory, "京东").catch(() => []);
    error.evidenceDirectory = evidenceDirectory;
    error.evidenceFiles = listExistingEvidenceFiles(
      mergeEvidenceFiles(evidenceFiles, error.evidenceFiles, browserEvidenceFiles)
    );
    if (!error.evidencePath && error.evidenceFiles.length) {
      error.evidencePath = error.evidenceFiles[0].filePath;
    }
    keepBrowserOpen = shouldKeepBrowserForManualLogin(error);
    throw error;
  } finally {
    if (!keepBrowserOpen) await closeManagedChrome().catch(() => {});
  }
}

module.exports = {
  createStoreMetricResolvedConfig,
  collectPageWithEvidence,
  collectAndWriteJdStoreMetrics
};
