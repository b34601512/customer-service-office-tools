const fs = require("fs");
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
const { waitForTmallLoginReady } = require("../tmallLoginState");
const { captureTmallReportPayloads } = require("./tmallReportResponseCapture");
const { readTmallReportDomSnapshot } = require("./tmallReportDomParser");
const { buildTmallStoreMetricRecords } = require("./tmallReportPayloadParser");
const { writeStoreMetricRecords } = require("../../../summaryData/storeMetricWorkbookWriter");
const { retiredDataSourcePages } = require("../../../summaryData/storeMetricDataSourceSchema");
const { notifyProgress, captureFailurePageEvidence } = require("../../storeMetricsShared");

function mergeRecordsByMetricName(primaryRecords, fallbackRecords) {
  const mergedRecords = [...primaryRecords];
  const knownMetricNames = new Set(primaryRecords.map((record) => record.metricName));
  for (const fallbackRecord of fallbackRecords) {
    if (knownMetricNames.has(fallbackRecord.metricName)) continue;
    knownMetricNames.add(fallbackRecord.metricName);
    mergedRecords.push(fallbackRecord);
  }
  return mergedRecords;
}

async function collectTmallReportRecords(page, store, dateSelection) {
  const capturedPayloads = await captureTmallReportPayloads(page, dateSelection);
  const collectedAt = new Date().toISOString();
  let interfaceRecords = [];
  let skipped = [];
  if (capturedPayloads) {
    const interfaceResult = buildTmallStoreMetricRecords({
      store,
      ...capturedPayloads,
      collectedAt
    });
    interfaceRecords = interfaceResult.records;
    skipped = interfaceResult.skipped;
  }
  if (interfaceRecords.length >= 13) return { records: interfaceRecords, skipped };
  const domResult = buildTmallStoreMetricRecords({
    store,
    ...(await readTmallReportDomSnapshot(page)),
    collectedAt
  });
  const mergedRecords = mergeRecordsByMetricName(interfaceRecords, domResult.records);
  for (const name of domResult.skipped) { if (!skipped.includes(name)) skipped.push(name); }
  if (!mergedRecords.length) {
    throw new Error("天猫真实体验分页未读到任何店铺考核指标。");
  }
  return { records: mergedRecords, skipped };
}

async function saveTmallSuccessEvidence(page, evidenceDirectory, evidenceFiles) {
  const screenshotPath = buildEvidenceFilePath({
    evidenceDirectory,
    evidenceLabel: "真实体验分",
    resultLabel: "读取成功",
    fileExtension: "png"
  });
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  if (fs.existsSync(screenshotPath)) {
    evidenceFiles.push({ label: "天猫真实体验分读取凭证", filePath: screenshotPath });
  }
}

function shouldKeepTmallBrowserOpen(error) {
  return /滑块|安全验证|扫码确认|等待天猫登录成功超时/.test(String(error?.message || error));
}

async function collectAndWriteTmallStoreMetrics({ config, store, dateSelection, onProgress }) {
  const evidenceDirectory = createStoreMetricEvidenceDirectory({
    platformKey: store.platformKey || "tmall",
    storeDisplayName: store.displayName,
    storeKey: store.key
  });
  const evidenceFiles = [];
  let keepBrowserOpen = false;
  let browser = null;
  try {
    notifyProgress(onProgress, `打开${store.displayName}`, "正在启动独立浏览器并进入真实体验分页");
    await runManagedOpenWindowEngine({
      platformKey: "tmall",
      storeConfig: {
        ...store,
        siteUrl: store.sources.serverReport
      },
      actionName: "打开真实体验分页",
      moduleName: "天猫店铺指标",
      missingOpenUrlMessage: `${store.displayName}缺少真实体验分页地址。`
    });
    browser = await connectToChrome();
    const page = await waitForTmallLoginReady(browser, store, {
      onLoginSubmitted() {
        notifyProgress(onProgress, "等待天猫登录", "账号密码已提交；如出现验证，请在浏览器中完成。");
      },
      onManualVerification(reason) {
        notifyProgress(onProgress, "等待人工验证", `${store.displayName}需要${reason}，程序停在原地等待。`);
      }
    });
    notifyProgress(onProgress, "天猫登录成功", `已进入${store.displayName}真实体验分页`);
    notifyProgress(onProgress, "读取页面指标", "读取总分、维度分和店铺考核最终数值");
    const { records, skipped } = await collectTmallReportRecords(page, store, dateSelection);
    await saveTmallSuccessEvidence(page, evidenceDirectory, evidenceFiles);
    await disconnectFromChrome(browser, "天猫店铺指标读取完成，断开自动化连接");
    browser = null;
    notifyProgress(onProgress, "写入统一数据源", `本次共 ${records.length} 条天猫店铺指标`);
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
      await disconnectFromChrome(browser, "天猫店铺指标失败，断开自动化连接").catch(() => {});
      browser = null;
    }
    const failureEvidenceFiles = await captureFailurePageEvidence(evidenceDirectory, "天猫").catch(() => []);
    error.evidenceDirectory = evidenceDirectory;
    error.evidenceFiles = listExistingEvidenceFiles(
      mergeEvidenceFiles(evidenceFiles, error.evidenceFiles, failureEvidenceFiles)
    );
    if (!error.evidencePath && error.evidenceFiles.length) {
      error.evidencePath = error.evidenceFiles[0].filePath;
    }
    keepBrowserOpen = shouldKeepTmallBrowserOpen(error);
    throw error;
  } finally {
    if (browser) await disconnectFromChrome(browser, "天猫店铺指标任务结束，断开自动化连接").catch(() => {});
    if (!keepBrowserOpen) await closeManagedChrome().catch(() => {});
  }
}

module.exports = {
  mergeRecordsByMetricName,
  collectTmallReportRecords,
  shouldKeepTmallBrowserOpen,
  collectAndWriteTmallStoreMetrics
};
