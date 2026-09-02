// 该文件收口四个平台店铺指标采集器的共享支撑逻辑：进度回调、失败现场凭证和手动日期兜底。
const fs = require("fs");
const {
  buildEvidenceFilePath
} = require("../shared/evidenceFiles");
const { connectToChrome, disconnectFromChrome } = require("../engine/chromeSession");

function notifyProgress(onProgress, stage, detail = "") {
  if (typeof onProgress === "function") onProgress({ stage, detail, at: new Date().toISOString() });
}

// 手动日期与各平台采集器共用的兜底口径：manual 模式且日期合法时取当日零点，否则取当前时间。
function resolveSnapshotDateFallback(dateSelection) {
  const snapshotDate = dateSelection?.mode === "manual" ? dateSelection.manual?.snapshotDate : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(String(snapshotDate || ""))
    ? new Date(`${snapshotDate}T00:00:00`)
    : new Date();
}

async function captureFailurePageEvidence(evidenceDirectory, platformLabel) {
  const browser = await connectToChrome({ shouldLog: false }).catch(() => null);
  if (!browser) return [];
  const evidenceFiles = [];
  try {
    for (const [pageIndex, page] of browser.contexts().flatMap((context) => context.pages()).entries()) {
      const screenshotPath = buildEvidenceFilePath({
        evidenceDirectory,
        evidenceLabel: `登录页面-${pageIndex + 1}`,
        resultLabel: "读取失败",
        fileExtension: "png"
      });
      const textPath = buildEvidenceFilePath({
        evidenceDirectory,
        evidenceLabel: `登录页面-${pageIndex + 1}`,
        resultLabel: "读取失败",
        fileExtension: "txt"
      });
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      const pageText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
      fs.writeFileSync(textPath, `URL: ${page.url()}\nTITLE: ${await page.title().catch(() => "")}\n\n${pageText}`, "utf8");
      if (fs.existsSync(screenshotPath)) evidenceFiles.push({ label: `${platformLabel}失败页面${pageIndex + 1}`, filePath: screenshotPath });
      if (fs.existsSync(textPath)) evidenceFiles.push({ label: `${platformLabel}失败页面${pageIndex + 1}文字`, filePath: textPath });
    }
  } finally {
    await disconnectFromChrome(browser, `${platformLabel}失败凭证已保存，断开自动化连接`).catch(() => {});
  }
  return evidenceFiles;
}

module.exports = {
  notifyProgress,
  resolveSnapshotDateFallback,
  captureFailurePageEvidence
};
