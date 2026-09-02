const fs = require("fs");
const appConfig = require("../../../config/appConfig");
const { runManagedOpenWindowEngine } = require("../../../shared/managedOpenWindowEngine");
const {
  createStoreMetricEvidenceDirectory,
  buildEvidenceFilePath,
  mergeEvidenceFiles,
  listExistingEvidenceFiles
} = require("../../../shared/evidenceFiles");
const {
  connectToChrome,
  disconnectFromChrome,
  closeManagedChrome
} = require("../../../engine/chromeSession");
const { ensureDouyinMerchantSession } = require("../douyinLoginRecovery");
const { ensureDouyinActiveStore } = require("../douyinStoreIdentity");
const {
  navigateDouyinExperienceScorePage,
  waitForDouyinExperienceScoreReady,
  DouyinLoginRequiredError
} = require("./douyinPageNavigator");
const { buildDouyinStoreMetricRecords } = require("./douyinReportPayloadParser");
const { writeStoreMetricRecords } = require("../../../summaryData/storeMetricWorkbookWriter");
const { retiredDataSourcePages } = require("../../../summaryData/storeMetricDataSourceSchema");
const {
  notifyProgress,
  resolveSnapshotDateFallback,
  captureFailurePageEvidence
} = require("../../storeMetricsShared");

function pickDouyinPage(browser) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  return pages.find((page) => /jinritemai\.com|douyin\.com/i.test(page.url())) || pages[0];
}

async function captureDouyinPageEvidence(page, evidenceDirectory, evidenceFiles) {
  const screenshotPath = buildEvidenceFilePath({
    evidenceDirectory,
    evidenceLabel: "抖音-服务体验",
    resultLabel: "读取成功",
    fileExtension: "png"
  });
  const textPath = buildEvidenceFilePath({
    evidenceDirectory,
    evidenceLabel: "抖音-服务体验",
    resultLabel: "读取成功",
    fileExtension: "txt"
  });
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  const pageText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  fs.writeFileSync(textPath, `URL: ${page.url()}\n\n${pageText}`, "utf8");
  if (fs.existsSync(screenshotPath)) evidenceFiles.push({ label: "抖音服务体验读取凭证", filePath: screenshotPath });
  if (fs.existsSync(textPath)) evidenceFiles.push({ label: "抖音服务体验文字凭证", filePath: textPath });
}

function shouldKeepDouyinBrowserOpen(error) {
  return error instanceof DouyinLoginRequiredError ||
    /登录|人工切店|切换抖音店铺|验证码|滑块|安全验证|等待抖音/.test(String(error?.message || error));
}

async function collectAndWriteDouyinStoreMetrics({ config, store, dateSelection, onProgress }) {
  const evidenceDirectory = createStoreMetricEvidenceDirectory({
    platformKey: store.platformKey || "douyin",
    storeDisplayName: store.displayName,
    storeKey: store.key
  });
  const evidenceFiles = [];
  let browser = null;
  let keepBrowserOpen = false;
  try {
    const sourceUrl = store.sources.experienceScore || appConfig.douyin.siteUrl;
    notifyProgress(onProgress, `打开${store.displayName}`, "正在启动独立浏览器并进入抖音服务体验页面");
    await runManagedOpenWindowEngine({
      platformKey: "douyin",
      storeConfig: { ...store, siteUrl: sourceUrl },
      actionName: "打开抖音服务体验页面",
      moduleName: "抖音店铺指标",
      missingOpenUrlMessage: `${store.displayName}缺少抖音服务体验页面地址。`
    });
    browser = await connectToChrome({ timeoutMs: appConfig.douyin.connectTimeoutMs });
    let page = pickDouyinPage(browser);
    if (!page) throw new Error("未找到抖音业务浏览器页面。");
    await page.bringToFront().catch(() => {});
    page = await ensureDouyinMerchantSession(browser, page, (stage, detail) => notifyProgress(onProgress, stage, detail));
    const storeStatus = await ensureDouyinActiveStore(page, store, (stage, detail) => notifyProgress(onProgress, stage, detail));
    page = storeStatus.page;
    notifyProgress(onProgress, "确认抖音店铺", `当前=${storeStatus.identity.storeName}(${storeStatus.identity.storeId})`);
    await navigateDouyinExperienceScorePage(page, sourceUrl);
    notifyProgress(onProgress, "读取页面指标", "读取服务体验得分、服务考核指标和差行为数据");
    const pageText = await waitForDouyinExperienceScoreReady(page, appConfig.douyin.connectTimeoutMs);
    const { records, skipped } = buildDouyinStoreMetricRecords({
      store,
      pageText,
      sourceUrl,
      fallbackDate: resolveSnapshotDateFallback(dateSelection)
    });
    await captureDouyinPageEvidence(page, evidenceDirectory, evidenceFiles);
    await disconnectFromChrome(browser, "抖音店铺指标读取完成，断开自动化连接");
    browser = null;
    notifyProgress(onProgress, "写入统一数据源", `本次共 ${records.length} 条抖音店铺指标`);
    const writeResult = await writeStoreMetricRecords({
      workbookPath: config.workbook.path,
      records,
      retiredSourcePages: retiredDataSourcePages
    });
    notifyProgress(onProgress, "完成", `写入 ${writeResult.writtenCount} 条，替换 ${writeResult.replacedCount} 条`);
    return {
      workbookPath: config.workbook.path,
      evidenceDirectory,
      evidenceFiles: listExistingEvidenceFiles(evidenceFiles),
      metricCount: records.length,
      skippedMetrics: skipped,
      recordKeys: records.map((record) => record.recordKey).filter(Boolean),
      records,
      writeResult
    };
  } catch (error) {
    if (browser) {
      await disconnectFromChrome(browser, "抖音店铺指标失败，断开自动化连接").catch(() => {});
      browser = null;
    }
    const failureEvidenceFiles = await captureFailurePageEvidence(evidenceDirectory, "抖音").catch(() => []);
    error.evidenceDirectory = evidenceDirectory;
    error.evidenceFiles = listExistingEvidenceFiles(
      mergeEvidenceFiles(evidenceFiles, error.evidenceFiles, failureEvidenceFiles)
    );
    if (!error.evidencePath && error.evidenceFiles.length) error.evidencePath = error.evidenceFiles[0].filePath;
    keepBrowserOpen = shouldKeepDouyinBrowserOpen(error);
    throw error;
  } finally {
    if (browser) await disconnectFromChrome(browser, "抖音店铺指标任务结束，断开自动化连接").catch(() => {});
    if (!keepBrowserOpen) await closeManagedChrome().catch(() => {});
  }
}

module.exports = {
  resolveSnapshotDateFallback,
  shouldKeepDouyinBrowserOpen,
  collectAndWriteDouyinStoreMetrics
};
