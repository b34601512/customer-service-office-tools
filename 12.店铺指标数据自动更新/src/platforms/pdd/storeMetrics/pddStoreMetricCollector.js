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
const { waitForPddLoginReady } = require("../pddLoginState");
const { assertPddStoreIdentityMatches } = require("../pddStoreIdentity");
const { readPddMetricTabSnapshot } = require("./pddPageNavigator");
const { buildPddStoreMetricRecords } = require("./pddReportPayloadParser");
const { writeStoreMetricRecords } = require("../../../summaryData/storeMetricWorkbookWriter");
const { retiredDataSourcePages } = require("../../../summaryData/storeMetricDataSourceSchema");
const {
  notifyProgress,
  resolveSnapshotDateFallback,
  captureFailurePageEvidence
} = require("../../storeMetricsShared");

const PDD_EVIDENCE_PAGE_DISPLAY_NAME_BY_TYPE = {
  customer: "客服数据",
  afterSales: "售后数据",
  overall: "综合体验星级"
};

function resolvePddEvidencePageDisplayName(pageType) {
  return PDD_EVIDENCE_PAGE_DISPLAY_NAME_BY_TYPE[pageType] || String(pageType || "未知页面");
}

async function capturePddPageEvidence(page, pageType, evidenceDirectory, evidenceFiles) {
  const pageDisplayName = resolvePddEvidencePageDisplayName(pageType);
  const filePath = buildEvidenceFilePath({
    evidenceDirectory,
    evidenceLabel: `拼多多-${pageDisplayName}`,
    resultLabel: "读取成功",
    fileExtension: "png"
  });
  const textPath = buildEvidenceFilePath({
    evidenceDirectory,
    evidenceLabel: `拼多多-${pageDisplayName}`,
    resultLabel: "读取成功",
    fileExtension: "txt"
  });
  await page.screenshot({ path: filePath, fullPage: true }).catch(() => {});
  const pageText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  fs.writeFileSync(textPath, `URL: ${page.url()}\n\n${pageText}`, "utf8");
  if (fs.existsSync(filePath)) evidenceFiles.push({ label: `拼多多${pageDisplayName}读取凭证`, filePath });
  if (fs.existsSync(textPath)) evidenceFiles.push({ label: `拼多多${pageDisplayName}文字凭证`, filePath: textPath });
}

function shouldKeepPddBrowserOpen(error) {
  return /滑块|安全验证|验证码|扫码确认|等待拼多多登录成功超时/.test(String(error?.message || error));
}

async function collectAndWritePddStoreMetrics({ config, store, dateSelection, onProgress }) {
  const evidenceDirectory = createStoreMetricEvidenceDirectory({
    platformKey: store.platformKey || "pdd",
    storeDisplayName: store.displayName,
    storeKey: store.key
  });
  const evidenceFiles = [];
  let browser = null;
  let keepBrowserOpen = false;
  try {
    notifyProgress(onProgress, `打开${store.displayName}`, "正在启动独立浏览器并使用脚本登录拼多多");
    await runManagedOpenWindowEngine({
      platformKey: "pdd",
      storeConfig: { ...store, siteUrl: store.sources.customer || appConfig.pdd.siteUrl },
      actionName: "打开拼多多店铺指标页面",
      moduleName: "拼多多店铺指标",
      missingOpenUrlMessage: `${store.displayName}缺少拼多多店铺指标页面地址。`
    });
    browser = await connectToChrome({ timeoutMs: appConfig.pdd.connectTimeoutMs });
    const page = await waitForPddLoginReady(browser, { ...store, siteUrl: store.sources.customer }, {
      onLoginSubmitted() {
        notifyProgress(onProgress, "拼多多登录中", "账号密码已由脚本提交；如出现滑块或验证码，请在浏览器中完成。");
      },
      onManualVerification(reason) {
        notifyProgress(onProgress, "等待人工验证", `${store.displayName}需要${reason}，程序停在原地等待。`);
      }
    });
    await assertPddStoreIdentityMatches(page, store);
    notifyProgress(onProgress, "拼多多登录成功", `已确认${store.displayName}页面身份`);

    if (!page.url().includes("/sycm/goods_quality/")) {
      await page.goto(store.sources.customer, { waitUntil: "domcontentloaded", timeout: 45000 });
    }
    notifyProgress(onProgress, "读取页面指标", "依次读取客服数据、售后数据和综合体验星级");
    const pageSnapshots = [];
    for (const [index, pageType] of ["customer", "afterSales", "overall"].entries()) {
      const snapshot = await readPddMetricTabSnapshot(page, pageType, {
        clickTab: index > 0,
        timeoutMs: appConfig.pdd.connectTimeoutMs
      });
      pageSnapshots.push(snapshot);
      await capturePddPageEvidence(page, pageType, evidenceDirectory, evidenceFiles);
    }
    const { records, skipped } = buildPddStoreMetricRecords({
      store,
      pageSnapshots,
      fallbackDate: resolveSnapshotDateFallback(dateSelection)
    });
    await disconnectFromChrome(browser, "拼多多店铺指标读取完成，断开自动化连接");
    browser = null;
    notifyProgress(onProgress, "写入统一数据源", `本次共 ${records.length} 条拼多多店铺指标`);
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
      await disconnectFromChrome(browser, "拼多多店铺指标失败，断开自动化连接").catch(() => {});
      browser = null;
    }
    const failureEvidenceFiles = await captureFailurePageEvidence(evidenceDirectory, "拼多多").catch(() => []);
    error.evidenceDirectory = evidenceDirectory;
    error.evidenceFiles = listExistingEvidenceFiles(
      mergeEvidenceFiles(evidenceFiles, error.evidenceFiles, failureEvidenceFiles)
    );
    if (!error.evidencePath && error.evidenceFiles.length) error.evidencePath = error.evidenceFiles[0].filePath;
    keepBrowserOpen = shouldKeepPddBrowserOpen(error);
    throw error;
  } finally {
    if (browser) await disconnectFromChrome(browser, "拼多多店铺指标任务结束，断开自动化连接").catch(() => {});
    if (!keepBrowserOpen) await closeManagedChrome().catch(() => {});
  }
}

module.exports = {
  resolvePddEvidencePageDisplayName,
  shouldKeepPddBrowserOpen,
  collectAndWritePddStoreMetrics
};
