const { log } = require("../../engine/logger");
const { captureDownloadEvidence } = require("../../shared/downloadEvidence");
const { dismissBlockingPopups } = require("../../shared/blockingPopupEngine");

async function restorePddEvidenceViewport(page) {
  // 该函数只把鼠标和页面滚动恢复到原点。
  await page.mouse.move(1, 1);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function capturePddDownloadEvidence(page, options = {}, label = "拼多多下载凭证") {
  // 该函数只在真实关闭遮挡弹窗后生成凭证，不再伪造无弹窗截图。
  const closedPopupCount = await dismissBlockingPopups(page, { platformName: "拼多多" });
  if (closedPopupCount > 0) {
    log("主线:完成", "拼多多凭证", "关闭遮挡弹窗", `已关闭=${closedPopupCount}`);
  }
  await restorePddEvidenceViewport(page);
  return captureDownloadEvidence(page, options, label);
}

module.exports = {
  capturePddDownloadEvidence
};
