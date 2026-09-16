const assert = require("assert");
const path = require("path");
const {
  formatEvidenceTimestamp,
  buildEvidenceStoreFolderName,
  buildEvidenceScopeName,
  buildEvidenceFileName
} = require("../src/shared/evidenceNaming");
const { createSummaryEvidenceDir } = require("../src/summary/summaryEvidenceDir");

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
      evidenceLabel: "失败原因",
      extension: ".txt"
    }),
    "2026-08-04_11-57-03-837_抖音_dedakj抖音_失败原因.txt"
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

async function main() {
  testReadableEvidenceNames();
  testReadableEvidenceDirectoryHierarchy();
  console.log("PASS 凭证目录和文件名可直接识别平台、店铺与用途");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
