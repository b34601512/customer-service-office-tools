const assert = require("assert");
const path = require("path");
const {
  formatEvidenceTimestamp,
  buildEvidenceStoreFolderName,
  buildEvidenceScopeName,
  buildEvidenceFileName
} = require("../src/shared/evidenceNaming");
const { createSummaryEvidenceDir } = require("../src/summary/summaryEvidenceDir");
const { downloadSummarySource } = require("../src/summary/storeSummaryParts/summarySourceDownloader");

const fixedEvidenceDate = new Date(2026, 7, 4, 11, 57, 3, 837);
const evidenceTask = {
  platformLabel: "抖音",
  platformKey: "douyin",
  storeDisplayName: "dedakj抖音",
  storeKey: "douyin2"
};

function testReadableEvidenceNames() {
  assert.strictEqual(formatEvidenceTimestamp(fixedEvidenceDate), "2026-08-04_11-57-03-837");
  assert.strictEqual(buildEvidenceStoreFolderName(evidenceTask), "dedakj抖音_douyin2");
  assert.strictEqual(buildEvidenceScopeName(evidenceTask), "抖音_dedakj抖音");
  assert.strictEqual(
    buildEvidenceFileName({
      createdAt: fixedEvidenceDate,
      fileNamePrefix: buildEvidenceScopeName(evidenceTask),
      evidenceLabel: "抖音客服数据下载后",
      extension: ".png"
    }),
    "2026-08-04_11-57-03-837_抖音_dedakj抖音_抖音客服数据下载后.png"
  );
}

function testReadableEvidenceDirectoryHierarchy() {
  const evidenceDirectory = createSummaryEvidenceDir({
    projectRoot: "D:\\客服项目",
    ...evidenceTask,
    createdAt: fixedEvidenceDate
  });
  assert.strictEqual(
    evidenceDirectory,
    path.join(
      "D:\\客服项目",
      "runtime",
      "evidence",
      "summary",
      "抖音",
      "dedakj抖音_douyin2",
      "2026-08-04_11-57-03-837"
    )
  );
}

async function testEvidencePrefixReachesPlatformDownloader() {
  let receivedDownloadOptions = null;
  await downloadSummarySource({
    task: evidenceTask,
    sourceGroup: {
      downloadReportKey: "performance",
      reportKeys: ["performance"],
      contexts: [{ resolvedConfig: { activeStore: { metricMappings: [] } } }]
    },
    dateRange: { startText: "2026-08-01", endText: "2026-08-02" },
    evidenceDir: "D:\\凭证",
    evidenceFiles: [],
    evidenceFileNamePrefix: "抖音_dedakj抖音",
    async ensurePlatformWindow() {},
    downloadFunctionByPlatform: {
      async douyin(onProgress, downloadOptions) {
        receivedDownloadOptions = downloadOptions;
        return "D:\\源文件.xlsx";
      }
    }
  });
  assert.strictEqual(receivedDownloadOptions.evidenceFileNamePrefix, "抖音_dedakj抖音");
}

async function main() {
  testReadableEvidenceNames();
  testReadableEvidenceDirectoryHierarchy();
  await testEvidencePrefixReachesPlatformDownloader();
  console.log("PASS 凭证目录和文件名可直接识别平台、店铺与用途");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
