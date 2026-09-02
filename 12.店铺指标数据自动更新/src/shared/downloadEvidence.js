const fs = require("fs");
const path = require("path");

async function captureDownloadEvidence(page, options = {}, label = "下载凭证", screenshotOptions = {}) {
  // 这里统一保存下载关键节点截图，并把截图路径回填给首页任务凭证列。
  const evidenceDir = String(options.evidenceDir || "").trim();
  if (!evidenceDir) {
    return "";
  }

  fs.mkdirSync(evidenceDir, { recursive: true });
  const safeLabel = String(label || "下载凭证").replace(/[\\/:*?"<>|\s]+/g, "-");
  const filePath = path.join(evidenceDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeLabel}.png`);
  await page.screenshot({ ...screenshotOptions, path: filePath, fullPage: true });
  if (Array.isArray(options.evidenceFiles)) {
    options.evidenceFiles.push({ label, filePath });
  }
  return filePath;
}

module.exports = {
  captureDownloadEvidence
};
