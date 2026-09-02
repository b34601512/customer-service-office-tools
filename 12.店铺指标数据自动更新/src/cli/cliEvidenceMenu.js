const fs = require("fs");
const path = require("path");
const appConfig = require("../config/appConfig");
const {
  revealLocalPath
} = require("../controlCenter/localFileApiParts/windowsLocalFileActions");

const DEFAULT_STORE_METRIC_EVIDENCE_ROOT = path.join(
  appConfig.projectRoot,
  "runtime",
  "evidence",
  "store-metrics"
);

function ensureStoreMetricEvidenceRoot(evidenceRoot = DEFAULT_STORE_METRIC_EVIDENCE_ROOT) {
  const normalizedEvidenceRoot = path.resolve(evidenceRoot);
  fs.mkdirSync(normalizedEvidenceRoot, { recursive: true });
  return normalizedEvidenceRoot;
}

function openRecentEvidenceFolder({
  evidenceRoot = DEFAULT_STORE_METRIC_EVIDENCE_ROOT,
  revealPath = revealLocalPath
} = {}) {
  return revealPath(ensureStoreMetricEvidenceRoot(evidenceRoot));
}

module.exports = {
  DEFAULT_STORE_METRIC_EVIDENCE_ROOT,
  ensureStoreMetricEvidenceRoot,
  openRecentEvidenceFolder
};
