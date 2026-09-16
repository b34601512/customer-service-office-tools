const fs = require("fs");
const path = require("path");
const { buildEvidenceFileName, buildEvidenceScopeName } = require("../../shared/evidenceNaming");
const { createSummaryEvidenceDir } = require("../summaryEvidenceDir");

function writeSummaryFailureTextEvidence(evidenceDir, task, errorMessage, evidenceFiles) {
  // 这个函数只把一次失败原因写成可回查文本凭证（不连浏览器、不截图）。
  fs.mkdirSync(evidenceDir, { recursive: true });
  const filePath = path.join(evidenceDir, buildEvidenceFileName({
    fileNamePrefix: buildEvidenceScopeName(task),
    evidenceLabel: "失败原因",
    extension: ".txt"
  }));
  fs.writeFileSync(filePath, [
    `店铺：${task.storeDisplayName || task.storeKey}`,
    `平台：${task.platformLabel || task.platformKey}`,
    `时间：${new Date().toISOString()}`,
    `原因：${errorMessage || "未读到错误原因"}`
  ].join("\n"), "utf8");
  evidenceFiles.push({ label: "失败原因", filePath });
  return filePath;
}

async function ensureSummaryErrorEvidence(task, error, projectRoot) {
  // 这个函数只确保原始任务错误绑定一组失败凭证。
  if (Array.isArray(error?.summaryEvidenceFiles) && error.summaryEvidenceFiles.length > 0) {
    return error.summaryEvidenceFiles;
  }
  const evidenceFiles = [];
  const evidenceDir = createSummaryEvidenceDir({
    projectRoot: projectRoot || path.resolve(__dirname, "..", "..", ".."),
    platformLabel: task.platformLabel,
    platformKey: task.platformKey,
    storeDisplayName: task.storeDisplayName,
    storeKey: task.storeKey
  });
  const errorMessage = error instanceof Error ? error.message : String(error);
  writeSummaryFailureTextEvidence(evidenceDir, task, errorMessage, evidenceFiles);
  error.summaryEvidenceFiles = evidenceFiles;
  return evidenceFiles;
}

function writeSummaryEvidenceCaptureFailure(task, taskError, evidenceError, projectRoot) {
  // 这个函数只在逐店外层把任务错误和凭证错误共同写入文本凭证。
  const evidenceFiles = [];
  const evidenceDir = createSummaryEvidenceDir({
    projectRoot: projectRoot || path.resolve(__dirname, "..", "..", ".."),
    platformLabel: task.platformLabel,
    platformKey: task.platformKey,
    storeDisplayName: task.storeDisplayName,
    storeKey: task.storeKey
  });
  const taskMessage = taskError instanceof Error ? taskError.message : String(taskError);
  const evidenceMessage = evidenceError instanceof Error ? evidenceError.message : String(evidenceError);
  writeSummaryFailureTextEvidence(
    evidenceDir,
    task,
    `${taskMessage}\n失败凭证采集错误：${evidenceMessage}`,
    evidenceFiles
  );
  return evidenceFiles;
}

module.exports = {
  writeSummaryFailureTextEvidence,
  ensureSummaryErrorEvidence,
  writeSummaryEvidenceCaptureFailure
};
