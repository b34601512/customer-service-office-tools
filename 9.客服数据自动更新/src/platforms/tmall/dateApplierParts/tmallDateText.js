// 该文件用于解决天猫日期文本规范化、解析和匹配问题。
function normalizeDateText(text) {
  // 这里把面板预览和页面文本统一成同一种日期区间格式，避免分隔符差异影响验收。
  return String(text || "")
    .replace(/\s+/g, "")
    .replace(/已选择[:：]/g, "")
    .replace(/至/g, "~")
    .replace(/～/g, "~")
    .trim();
}

function buildExpectedDateText(range) {
  // 这里生成统一的期望文本，供错误提示和验收共用。
  return normalizeDateText(`${range.startText} ~ ${range.endText}`);
}

function parseTmallDateRangeText(text) {
  // 这里只解析明确的 yyyy-MM-dd ~ yyyy-MM-dd，避免把其他数字误判成日期。
  const normalizedText = normalizeDateText(text);
  const match = normalizedText.match(/(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})/);

  if (!match) {
    return null;
  }

  return {
    startText: match[1],
    endText: match[2],
    normalizedText: `${match[1]}~${match[2]}`
  };
}

function isTmallDateRangeMatched(text, range) {
  // 这里用解析结果比对配置日期，保证页面最终确实命中目标区间。
  const parsedRange = parseTmallDateRangeText(text);
  return Boolean(
    parsedRange &&
      parsedRange.startText === range?.startText &&
      parsedRange.endText === range?.endText
  );
}

function describeTmallDateText(text) {
  // 这里把页面当前日期整理成人能读懂的报错文本。
  const parsedRange = parseTmallDateRangeText(text);
  if (parsedRange) {
    return `${parsedRange.startText} ~ ${parsedRange.endText}`;
  }

  const normalizedText = normalizeDateText(text);
  return normalizedText || "未读到日期文本";
}

module.exports = {
  normalizeDateText,
  buildExpectedDateText,
  parseTmallDateRangeText,
  isTmallDateRangeMatched,
  describeTmallDateText
};
