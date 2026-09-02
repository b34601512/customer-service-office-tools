// 该文件用于统一拼多多日期区间文本的标准化与匹配规则。
function normalizePddDateRangeText(value) {
  // 这里把页面可能出现的两种波浪号统一，确保匹配规则只有一套。
  return String(value || "")
    .replace(/[～]/g, "~")
    .replace(/\s+/g, "")
    .trim();
}

function isPddDateRangeTextMatched(text, range) {
  // 这里统一判断拼多多日期输入框是否已经命中目标区间，避免下载时沿用页面旧日期。
  const normalizedText = normalizePddDateRangeText(text);
  const expectedStart = String(range?.startText || "").trim();
  const expectedEnd = String(range?.endText || "").trim();
  if (!expectedStart || !expectedEnd) {
    return false;
  }

  return normalizedText.includes(`${expectedStart}~${expectedEnd}`);
}

module.exports = {
  normalizePddDateRangeText,
  isPddDateRangeTextMatched
};
