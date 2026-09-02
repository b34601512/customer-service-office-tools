const { formatDate } = require("../../../shared/exportDateRange");

function parseJdSystemPanelMonth(text) {
  // 这个函数只把京东系统面板年月标题解析成确定的年月值。
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
  const match = normalizedText.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (!match) {
    throw new Error(`京东系统日期面板月份文本无法识别：${normalizedText || "空"}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    text: normalizedText
  };
}

function toJdSystemMonthIndex(year, month) {
  // 这个函数只把年月转换成可比较的连续月份序号。
  return year * 12 + (month - 1);
}

function calculateJdSystemMonthShift(currentMonth, targetDate) {
  // 这个函数只计算当前面板月份到目标日期月份的偏移量。
  return toJdSystemMonthIndex(targetDate.getFullYear(), targetDate.getMonth() + 1) -
    toJdSystemMonthIndex(currentMonth.year, currentMonth.month);
}

function isJdSystemMonthVisible(months, targetDate) {
  // 这个函数只判断目标日期月份是否已显示在左右面板中。
  const targetIndex = toJdSystemMonthIndex(targetDate.getFullYear(), targetDate.getMonth() + 1);
  return targetIndex === toJdSystemMonthIndex(months.left.year, months.left.month) ||
    targetIndex === toJdSystemMonthIndex(months.right.year, months.right.month);
}

function resolveJdSystemPanelIndex(months, targetDate) {
  // 这个函数只确定目标日期属于左面板还是右面板。
  const targetIndex = toJdSystemMonthIndex(targetDate.getFullYear(), targetDate.getMonth() + 1);
  if (targetIndex === toJdSystemMonthIndex(months.left.year, months.left.month)) {
    return 0;
  }
  if (targetIndex === toJdSystemMonthIndex(months.right.year, months.right.month)) {
    return 1;
  }
  throw new Error(`京东系统日期面板当前没有显示 ${formatDate(targetDate)} 所在月份。`);
}

module.exports = {
  parseJdSystemPanelMonth,
  calculateJdSystemMonthShift,
  isJdSystemMonthVisible,
  resolveJdSystemPanelIndex
};
