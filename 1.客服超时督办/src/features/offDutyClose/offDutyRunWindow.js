function cloneDateAtMidnight(targetDate) {
  // 这里统一把日期压到零点，避免跨午夜窗口把排班基准日算偏。
  return new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0);
}

function addDays(baseDate, offsetDays) {
  const result = cloneDateAtMidnight(baseDate);
  result.setDate(result.getDate() + offsetDays);
  return result;
}

function resolveOffDutyScanDates(now = new Date()) {
  // 这里每轮同时检查今天和昨天，确保程序第二天启动时也能补处理前一天漏关的客服。
  const today = cloneDateAtMidnight(now);
  return [addDays(today, -1), today];
}

module.exports = {
  resolveOffDutyScanDates
};
