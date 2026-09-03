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

function extractDateTexts(text) {
  // 这里只做一件事：按出现顺序提取页面文本中的全部明确日期，供窗口比对使用。
  return normalizeDateText(text).match(/\d{4}-\d{2}-\d{2}/g) || [];
}

function isTmallDateRangeMatched(text, range) {
  // 验收只认业务真相：页面生效统计窗口=期望区间。
  // 单日区间会被天猫折叠成单个日期显示（如“统计时间2026-09-01”），也可能仍显示同日成对区间，两者都等价；
  // 多日区间必须命中成对日期，单日显示不能通过，防止筛选未生效被误判成功。
  const dateTexts = extractDateTexts(text);
  const startText = String(range?.startText || "").trim();
  const endText = String(range?.endText || "").trim();
  if (!startText || !endText) {
    return false;
  }
  if (startText === endText && dateTexts.length === 1) {
    return dateTexts[0] === startText;
  }
  return dateTexts.length === 2 && dateTexts[0] === startText && dateTexts[1] === endText;
}

function describeTmallDateText(text) {
  // 这里把页面当前日期整理成人能读懂的报错文本。
  const parsedRange = parseTmallDateRangeText(text);
  if (parsedRange) {
    return `${parsedRange.startText} ~ ${parsedRange.endText}`;
  }

  const dateTexts = extractDateTexts(text);
  if (dateTexts.length === 1) {
    return dateTexts[0];
  }

  const normalizedText = normalizeDateText(text);
  return normalizedText || "未读到日期文本";
}

module.exports = {
  normalizeDateText,
  buildExpectedDateText,
  parseTmallDateRangeText,
  extractDateTexts,
  isTmallDateRangeMatched,
  describeTmallDateText
};
