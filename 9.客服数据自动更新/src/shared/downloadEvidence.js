const fs = require("fs");
const path = require("path");
const { buildEvidenceFileName } = require("./evidenceNaming");
const { isScreenshotEvidenceEnabled } = require("./evidenceSettings");

async function captureDownloadEvidence(page, options = {}, label = "下载凭证", screenshotOptions = {}) {
  // 这里统一保存下载关键节点截图，并把截图路径回填给首页任务凭证列。
  // 截图凭证已停用（见 evidenceSettings.js）：直接返回空，不建目录、不截图、不抛错，
  // 这样「下载前/下载后」这两个纯留痕步骤不会再因为页面字体挂起而把整个店铺判失败。
  if (!isScreenshotEvidenceEnabled()) {
    return "";
  }
  const evidenceDir = String(options.evidenceDir || "").trim();
  if (!evidenceDir) {
    return "";
  }

  fs.mkdirSync(evidenceDir, { recursive: true });
  const filePath = path.join(evidenceDir, buildEvidenceFileName({
    fileNamePrefix: options.evidenceFileNamePrefix,
    evidenceLabel: label,
    extension: ".png"
  }));
  await page.screenshot({ ...screenshotOptions, path: filePath, fullPage: true });
  if (Array.isArray(options.evidenceFiles)) {
    options.evidenceFiles.push({ label, filePath });
  }
  return filePath;
}

module.exports = {
  captureDownloadEvidence
};
