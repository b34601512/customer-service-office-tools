const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  acquireSummarySource,
  shouldReuseSummarySourceRecord
} = require("../src/summary/storeSummaryParts/summarySourceAcquirer");
const {
  acquireStoreSummarySources,
  shouldForceStoreSourceRedownload,
  resolveStoreSourceReuseRecords
} = require("../src/summary/storeSummaryParts/summaryStoreRunner");
const {
  convertSourceCellToNumber,
  isMissingDurationText
} = require("../src/summaryData/summaryDataSourceReader");
const { buildResponseTotals, buildSummaryDataRows } = require("../src/summaryData/summaryDataRows");
const { buildReplacedSummaryRows } = require("../src/summaryData/summaryDataWriter");
const {
  findReusableSummarySourceFile,
  resolveSummarySourceReuseDecision
} = require("../src/summary/summarySourceReuse");
const {
  cleanOldSourceFiles,
  resetTaskHistory,
  isFileTodayOrLater
} = require("../src/summary/configuredWorkflowParts/summaryRunReset");

function buildSummarySourceInput(reusableRecord, downloadSummarySource) {
  return {
    task: {
      platformKey: "pdd",
      storeKey: "pdd02",
      storeDisplayName: "德达拼多多02"
    },
    sourceGroup: {
      reuseReportKeys: ["performance"],
      downloadReportKey: "performance",
      reportKeys: ["performance"]
    },
    dateRange: {
      startText: "2026-08-01",
      endText: "2026-08-02"
    },
    reportContexts: [{ resolvedConfig: { workbook: { path: "summary.xlsx" } } }],
    sourceFiles: [],
    evidenceFiles: [],
    findReusableSource: () => reusableRecord,
    downloadSummarySource,
    attachDownloadEvidenceFiles() {}
  };
}

function buildHistoryForReusableSource({ filePath, createdAt, exportEndText, workbookPath = "summary.xlsx" }) {
  const downloadRecord = {
    platformKey: "jd",
    storeKey: "jd1",
    reportKey: "performance",
    sourceReportKeys: ["performance"],
    filePath,
    exportStartText: "2026-08-01",
    exportEndText,
    createdAt
  };
  return {
    downloads: [downloadRecord],
    imports: [{
      platformKey: "jd",
      storeKey: "jd1",
      reportKey: "performance",
      sourceFilePath: filePath,
      workbookPath,
      exportStartText: "2026-08-01",
      exportEndText,
      createdAt: new Date(new Date(createdAt).getTime() + 1000).toISOString()
    }]
  };
}

function findReusableJdSourceForTest({ createdAt, exportEndText, now }) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "customer-summary-reuse-"));
  const sourceFilePath = path.join(temporaryDirectory, "source.xlsx");
  fs.writeFileSync(sourceFilePath, "xlsx-source");
  const decisions = [];
  const result = findReusableSummarySourceFile({
    platformKey: "jd",
    storeKey: "jd1",
    reportKeys: ["performance"],
    requiredReportKeys: ["performance"],
    dateRange: { startText: "2026-08-01", endText: exportEndText },
    workbookPath: "summary.xlsx",
    history: buildHistoryForReusableSource({
      filePath: sourceFilePath,
      createdAt,
      exportEndText
    }),
    now,
    onReuseDecision(decision) {
      decisions.push(decision);
    }
  });
  return { temporaryDirectory, result, decisions };
}

async function testNoUsableSourceIsDownloadedAgain() {
  let downloadCount = 0;
  const result = await acquireSummarySource(buildSummarySourceInput(
    null,
    async () => {
      downloadCount += 1;
      return "new.xls";
    }
  ));
  assert.strictEqual(downloadCount, 1);
  assert.strictEqual(result.reused, false);
  assert.strictEqual(result.filePath, "new.xls");
}

async function testExistingTodaySourceIsReused() {
  let downloadCount = 0;
  const result = await acquireSummarySource(buildSummarySourceInput(
    { filePath: "existing.xls", alreadyImported: true, evidenceFiles: [] },
    async () => {
      downloadCount += 1;
      return "unexpected.xls";
    }
  ));
  assert.strictEqual(downloadCount, 0);
  assert.strictEqual(result.reused, true);
  assert.strictEqual(result.filePath, "existing.xls");
}

function testOldDownloadIsNotReusable() {
  const { temporaryDirectory, result, decisions } = findReusableJdSourceForTest({
    createdAt: "2026-08-01T00:00:00.000Z",
    exportEndText: "2026-08-18",
    now: "2026-08-25T04:00:00.000Z"
  });
  try {
    assert.strictEqual(result, null);
    assert.match(decisions[0].reason, /没有找到今天下载/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function testTodayDownloadIsReusable() {
  const todaySource = findReusableJdSourceForTest({
    createdAt: "2026-08-25T02:00:00.000Z",
    exportEndText: "2026-08-18",
    now: "2026-08-25T04:00:00.000Z"
  });
  try {
    assert.strictEqual(todaySource.result.alreadyImported, true);
    assert.match(todaySource.decisions[0].reason, /今天下载.*允许复用/);
  } finally {
    fs.rmSync(todaySource.temporaryDirectory, { recursive: true, force: true });
  }
}

function testReuseDecisionTreatsTodayAndOldDownloadsCorrectly() {
  assert.strictEqual(
    resolveSummarySourceReuseDecision({
      record: { createdAt: "2026-08-01T00:00:00.000Z" },
      now: "2026-08-25T04:00:00.000Z"
    }).canReuse,
    false
  );
  assert.strictEqual(
    resolveSummarySourceReuseDecision({
      record: { createdAt: "2026-08-25T02:00:00.000Z" },
      now: "2026-08-25T04:00:00.000Z"
    }).canReuse,
    true
  );
}

async function testForceRedownloadNeverReusesSuccessfulSource() {
  let downloadCount = 0;
  const result = await acquireSummarySource({
    ...buildSummarySourceInput(
      { filePath: "existing.xls", alreadyImported: true, evidenceFiles: [] },
      async () => {
        downloadCount += 1;
        return "fresh.xls";
      }
    ),
    forceRedownload: true
  });
  assert.strictEqual(downloadCount, 1);
  assert.strictEqual(result.reused, false);
  assert.strictEqual(result.filePath, "fresh.xls");
}

function testSummaryRowsReplaceSameStoreAndPeriodInsteadOfAppending() {
  const result = buildReplacedSummaryRows(
    [
      { platform: "京东", storeKey: "jd1", periodStart: 1, periodEnd: 2, personName: "旧顾远" },
      { platform: "京东", storeKey: "jd1", periodStart: 1, periodEnd: 2, personName: "旧沈晴" },
      { platform: "京东", storeKey: "jd1", periodStart: 1, periodEnd: 3, personName: "历史数据" }
    ],
    [{ platform: "京东", storeKey: "jd1", periodStart: 1, periodEnd: 2, personName: "新顾远" }]
  );
  assert.strictEqual(result.removedCount, 2);
  assert.deepStrictEqual(result.rowsToWrite.map((row) => row.personName), ["历史数据", "新顾远"]);
}

function testMissingDurationValuesBecomeBlank() {
  assert.strictEqual(isMissingDurationText("--分--秒"), true);
  assert.strictEqual(convertSourceCellToNumber({ value: "--分--秒" }), null);
  assert.strictEqual(convertSourceCellToNumber({ value: "13分43秒" }), 823);
  assert.deepStrictEqual(
    buildResponseTotals({ response_weight: null, avg_response_time: 12 }),
    {
      responseWeight: null,
      responseTotalSeconds: null,
      threeMinuteWithinCount: null,
      thirtySecondWithinCount: null
    }
  );
  assert.strictEqual(shouldReuseSummarySourceRecord({}), false);
  assert.strictEqual(shouldReuseSummarySourceRecord({ filePath: "existing.xlsx" }), true);
}

function testSummaryUsesRawPerformanceCounts() {
  const [row] = buildSummaryDataRows({
    task: {
      platformKey: "tmall",
      platformLabel: "天猫",
      storeKey: "tmall1",
      storeDisplayName: "天猫一号"
    },
    dateRange: { startText: "2026-08-01", endText: "2026-08-19" },
    sourceFiles: [],
    reportReadResults: [{
      rows: [{
        personName: "客服甲",
        metrics: { amount: 100, inquiry: 55, order: 15 }
      }]
    }]
  });
  assert.strictEqual(row.salesAmount, 100);
  assert.strictEqual(row.inquiryCount, 55);
  assert.strictEqual(row.orderCount, 15);
}

function testDuplicateRawMetricsAddAndConflictingDerivedMetricsFail() {
  const [row] = buildSummaryDataRows({
    task: { platformKey: "tmall", platformLabel: "天猫", storeKey: "tmall1", storeDisplayName: "天猫一号" },
    dateRange: { startText: "2026-08-01", endText: "2026-08-19" },
    sourceFiles: [],
    reportReadResults: [{
      rows: [
        { personName: "客服甲", metrics: { amount: 100, inquiry: 55, order: 15, satisfied_count: 2, evaluation_count: 3 } },
        { personName: "客服甲", metrics: { amount: 50, inquiry: 5, order: 2, satisfied_count: 1, evaluation_count: 2 } }
      ]
    }]
  });
  assert.strictEqual(row.salesAmount, 150);
  assert.strictEqual(row.inquiryCount, 60);
  assert.strictEqual(row.orderCount, 17);
  assert.strictEqual(row.satisfiedCount, 3);
  assert.strictEqual(row.evaluationCount, 5);

  assert.throws(
    () => buildSummaryDataRows({
      task: { platformKey: "tmall", platformLabel: "天猫", storeKey: "tmall1", storeDisplayName: "天猫一号" },
      dateRange: { startText: "2026-08-01", endText: "2026-08-19" },
      sourceFiles: [],
      reportReadResults: [{
        rows: [
          { personName: "客服甲", metrics: { avg_response_time: 10 } },
          { personName: "客服甲", metrics: { avg_response_time: 12 } }
        ]
      }]
    }),
    /avg_response_time.*停止静默覆盖/
  );
}

async function testFailedStoreRedownloadsAllSourceGroups() {
  const downloadedSourceLabels = [];
  const sourceGroups = [
    { sourceKey: "source-a", label: "来源A", reportKeys: ["performance"] },
    { sourceKey: "source-b", label: "来源B", reportKeys: ["response_time"] }
  ];
  const reusableSourceRecords = [
    { alreadyImported: true },
    { alreadyImported: false }
  ];
  assert.strictEqual(shouldForceStoreSourceRedownload(reusableSourceRecords), true);
  assert.strictEqual(shouldForceStoreSourceRedownload([{ alreadyImported: true }], true), true);
  const sourceFiles = await acquireStoreSummarySources({
    task: { platformKey: "pdd", storeKey: "pdd02", storeDisplayName: "德达拼多多02" },
    dateRange: { startText: "2026-08-01", endText: "2026-08-02" },
    reportContexts: [{ resolvedConfig: { workbook: { path: "summary.xlsx" } } }],
    sourceGroups,
    reusableSourceRecords,
    forceRedownload: true,
    sourceFiles: [],
    evidenceFiles: [],
    downloadSummarySource: async ({ sourceGroup }) => {
      downloadedSourceLabels.push(sourceGroup.label);
      return `${sourceGroup.sourceKey}.xls`;
    },
    attachDownloadEvidenceFiles() {}
  });
  assert.deepStrictEqual(downloadedSourceLabels, ["来源A", "来源B"]);
  assert.deepStrictEqual(sourceFiles.map((item) => item.reused), [false, false]);
}

function testStoreReusePrecheckKeepsCompleteStoreContext() {
  const receivedLookupRequests = [];
  const reusableSourceRecords = resolveStoreSourceReuseRecords({
    task: { platformKey: "pdd", storeKey: "pdd02" },
    dateRange: { startText: "2026-08-01", endText: "2026-08-02" },
    reportContexts: [{ resolvedConfig: { workbook: { path: "summary.xlsx" } } }],
    sourceGroups: [{
      reuseReportKeys: ["performance"],
      downloadReportKey: "performance",
      reportKeys: ["performance", "response_time"]
    }],
    findReusableSource(lookupRequest) {
      receivedLookupRequests.push(lookupRequest);
      return { filePath: "existing.xls", alreadyImported: true };
    }
  });
  assert.deepStrictEqual(reusableSourceRecords, [
    { filePath: "existing.xls", alreadyImported: true }
  ]);
  assert.deepStrictEqual(receivedLookupRequests, [{
    platformKey: "pdd",
    storeKey: "pdd02",
    reportKeys: ["performance"],
    requiredReportKeys: ["performance", "response_time"],
    dateRange: { startText: "2026-08-01", endText: "2026-08-02" },
    workbookPath: "summary.xlsx"
  }]);
}

function testIsFileTodayOrLater() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "customer-summary-clean-"));
  try {
    const todayPath = path.join(temporaryDirectory, "20260801-20260826-抖音客服数据-今天下载.xlsx");
    const oldPath = path.join(temporaryDirectory, "20260801-20260826-抖音客服数据-旧文件.xlsx");
    fs.writeFileSync(todayPath, "x");
    fs.writeFileSync(oldPath, "x");
    const now = new Date("2026-08-25T12:00:00");
    // 该函数只看文件实际修改时间，不看文件名：抖音文件名以导出范围日期开头也能正确区分。
    fs.utimesSync(todayPath, now, now);
    fs.utimesSync(oldPath, new Date("2026-08-01T12:00:00"), new Date("2026-08-01T12:00:00"));
    assert.strictEqual(isFileTodayOrLater(todayPath, now), true);
    assert.strictEqual(isFileTodayOrLater(oldPath, now), false);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function testCleanOldSourceFilesKeepsOnlyToday() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "customer-summary-cleanroot-"));
  try {
    const storeDir = path.join(temporaryDirectory, "jd", "jd1");
    fs.mkdirSync(storeDir, { recursive: true });
    const todayPath = path.join(storeDir, "20260801-20260826-抖音客服数据-今天下载.xlsx");
    const oldPath = path.join(storeDir, "20260801-20260826-抖音客服数据-旧文件.xlsx");
    fs.writeFileSync(todayPath, "x");
    fs.writeFileSync(oldPath, "x");
    const now = new Date("2026-08-25T12:00:00");
    // 清理只看文件修改时间：抖音等文件名带导出范围日期的今天文件也必须保留。
    fs.utimesSync(todayPath, now, now);
    fs.utimesSync(oldPath, new Date("2026-08-01T12:00:00"), new Date("2026-08-01T12:00:00"));
    const result = cleanOldSourceFiles(temporaryDirectory, now);
    assert.strictEqual(result.removedCount, 1);
    assert.strictEqual(fs.existsSync(todayPath), true);
    assert.strictEqual(fs.existsSync(oldPath), false);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function testResetTaskHistoryKeepsTodayDownloadsAndClearsImports() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "customer-summary-history-"));
  const historyPath = path.join(temporaryDirectory, "history.json");
  try {
    const previousPath = process.env.CUSTOMER_PERFORMANCE_HISTORY_PATH;
    process.env.CUSTOMER_PERFORMANCE_HISTORY_PATH = historyPath;
    const { writeTaskHistory } = require("../src/shared/taskHistoryParts/taskHistoryStore");
    writeTaskHistory({
      downloads: [
        { createdAt: "2026-08-25T02:00:00.000Z", filePath: "today.xlsx" },
        { createdAt: "2026-08-01T00:00:00.000Z", filePath: "old.xlsx" }
      ],
      imports: [
        { createdAt: "2026-08-25T02:00:00.000Z", filePath: "today.xlsx" }
      ]
    });
    const now = new Date("2026-08-25T12:00:00");
    const result = resetTaskHistory(now);
    assert.strictEqual(result.removedDownloadRecords, 1);
    assert.strictEqual(result.clearedImportRecords, 1);
    const { readTaskHistory } = require("../src/shared/taskHistoryParts/taskHistoryStore");
    const history = readTaskHistory();
    assert.deepStrictEqual(history.downloads.map((record) => record.filePath), ["today.xlsx"]);
    assert.deepStrictEqual(history.imports, []);
    if (previousPath === undefined) {
      delete process.env.CUSTOMER_PERFORMANCE_HISTORY_PATH;
    } else {
      process.env.CUSTOMER_PERFORMANCE_HISTORY_PATH = previousPath;
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

(async () => {
  await testNoUsableSourceIsDownloadedAgain();
  await testExistingTodaySourceIsReused();
  testOldDownloadIsNotReusable();
  testTodayDownloadIsReusable();
  testReuseDecisionTreatsTodayAndOldDownloadsCorrectly();
  await testForceRedownloadNeverReusesSuccessfulSource();
  testSummaryRowsReplaceSameStoreAndPeriodInsteadOfAppending();
  testMissingDurationValuesBecomeBlank();
  testSummaryUsesRawPerformanceCounts();
  testDuplicateRawMetricsAddAndConflictingDerivedMetricsFail();
  await testFailedStoreRedownloadsAllSourceGroups();
  testStoreReusePrecheckKeepsCompleteStoreContext();
  testIsFileTodayOrLater();
  testCleanOldSourceFilesKeepsOnlyToday();
  testResetTaskHistoryKeepsTodayDownloadsAndClearsImports();
  console.log("PASS 今天源文件可复用，旧源文件会重新下载，无数据时长会留空");
})();
