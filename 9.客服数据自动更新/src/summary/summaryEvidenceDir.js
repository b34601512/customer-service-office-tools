const path = require("path");
const {
  normalizeEvidenceNamePart,
  formatEvidenceTimestamp,
  buildEvidenceStoreFolderName
} = require("../shared/evidenceNaming");

function createSummaryEvidenceDir({
  projectRoot,
  platformLabel = "",
  platformKey = "",
  storeDisplayName = "",
  storeKey = "",
  createdAt = new Date()
}) {
  // 这里按“平台/店铺/本次时间”分层，打开根目录即可直接找到目标店铺。
  const platformFolderName = normalizeEvidenceNamePart(platformLabel || platformKey, "未知平台");
  const storeFolderName = buildEvidenceStoreFolderName({ storeDisplayName, storeKey });
  const runFolderName = formatEvidenceTimestamp(createdAt);
  return path.join(
    projectRoot,
    "runtime",
    "evidence",
    "summary",
    platformFolderName,
    storeFolderName,
    runFolderName
  );
}

module.exports = {
  createSummaryEvidenceDir
};
