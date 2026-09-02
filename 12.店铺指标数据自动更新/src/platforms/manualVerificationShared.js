// 该文件用于解决天猫和拼多多人工验证文案判定逐字镜像、词表各自漂移的问题。
function normalizeVerificationText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function detectManualVerificationReason(text, pageUrl = "") {
  const normalizedText = normalizeVerificationText(text);
  if (/滑块|拖动滑块|按住.*滑动/.test(normalizedText)) return "滑块验证";
  if (/安全验证|身份验证|验证码|验证后继续/.test(normalizedText)) return "安全验证";
  if (/login|passport|auth/i.test(pageUrl) && /扫码登录|扫码确认/.test(normalizedText)) return "扫码确认";
  return "";
}

module.exports = {
  detectManualVerificationReason
};
