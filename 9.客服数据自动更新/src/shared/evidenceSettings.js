// 该文件用于集中控制「截图凭证」的采集开关。
//
// 2026-09-16 用户决定：停止保存任何页面截图凭证，改为自行查看平台后台与最终统计数据。
// 原因（实测）：
//   1. 截图只是「事后留痕」，不参与成败判定（判定下载成功与否用的是下载事件引擎）。
//   2. 采集路径用的是 page.screenshot({ fullPage: true })，Playwright 会先等页面字体加载完，
//      字体请求挂起时会死等到 30 秒超时抛错，导致整个店铺判失败。
//      历史 33 天采集日志里有 5 天出现该致命失败（另有 1 次卡在「下载后」，即文件已拷好却被丢弃）。
//   3. 纯文本凭证（失败原因、页面地址、日期范围、数据行数）仍然保留，它们不截图、不会卡住。
//
// 需要临时恢复截图时：设置环境变量 PI_EVIDENCE_SCREENSHOTS=1 即可，不必改代码。
const DEFAULT_SCREENSHOT_EVIDENCE_ENABLED = false;

function isScreenshotEvidenceEnabled() {
  const raw = String(process.env.PI_EVIDENCE_SCREENSHOTS || "").trim();
  if (!raw) {
    return DEFAULT_SCREENSHOT_EVIDENCE_ENABLED;
  }
  return !/^(0|false|no|off)$/i.test(raw);
}

module.exports = {
  DEFAULT_SCREENSHOT_EVIDENCE_ENABLED,
  isScreenshotEvidenceEnabled
};
