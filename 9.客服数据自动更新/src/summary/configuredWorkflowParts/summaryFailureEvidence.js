const fs = require("fs");
const path = require("path");
const { waitForChromeDebugPortReady, connectToChrome, disconnectFromChrome } = require("../../engine/chromeSession");
const { captureDownloadEvidence } = require("../../shared/downloadEvidence");
const { buildEvidenceFileName, buildEvidenceScopeName } = require("../../shared/evidenceNaming");
const { createSummaryEvidenceDir } = require("../summaryEvidenceDir");

function writeSummaryFailureTextEvidence(evidenceDir, task, errorMessage, evidenceFiles) {
  // 这个函数只把一次失败原因写成可回查文本凭证。
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

function pickSummaryEvidencePage(browser) {
  // 这个函数只选择受控浏览器中的第一个真实业务页面。
  return browser.contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url?.() && page.url() !== "about:blank") || null;
}

async function captureSummaryFailureEvidence(input, dependencies = {}) {
  // 这个函数只按当前浏览器状态采集截图或写入失败文本，不处理自身错误。
  const { task, evidenceDir, evidenceFiles, errorMessage } = input;
  const waitForPort = dependencies.waitForChromeDebugPortReady || waitForChromeDebugPortReady;
  const connect = dependencies.connectToChrome || connectToChrome;
  const disconnect = dependencies.disconnectFromChrome || disconnectFromChrome;
  const capture = dependencies.captureDownloadEvidence || captureDownloadEvidence;
  if (!(await waitForPort({ timeoutMs: 800, pollIntervalMs: 100 }))) {
    return writeSummaryFailureTextEvidence(evidenceDir, task, errorMessage, evidenceFiles);
  }
  const browser = await connect({ timeoutMs: 3000, portReadyTimeoutMs: 1000 });
  try {
    const page = pickSummaryEvidencePage(browser);
    return page
      ? await capture(page, {
          evidenceDir,
          evidenceFiles,
          evidenceFileNamePrefix: buildEvidenceScopeName(task)
        }, "失败现场")
      : writeSummaryFailureTextEvidence(evidenceDir, task, errorMessage, evidenceFiles);
  } finally {
    await disconnect(browser, "批量汇总失败凭证已采集");
  }
}

async function ensureSummaryErrorEvidence(task, error, projectRoot, dependencies = {}) {
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
  await captureSummaryFailureEvidence({ task, evidenceDir, evidenceFiles, errorMessage }, dependencies);
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
