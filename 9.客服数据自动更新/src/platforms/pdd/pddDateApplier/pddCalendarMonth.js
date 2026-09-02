// 该文件用于统一拼多多双月日历的月份计算与状态标识。
function toMonthIndex(year, month) {
  // 这里把年月转换为连续序号，便于直接比较前后月份。
  return Number(year) * 12 + (Number(month) - 1);
}

function toDateMonth(date) {
  // 这里从日期对象提取日历导航只需要的年月。
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1
  };
}

function isSameMonth(left, right) {
  // 这里仅比较年月，避免日期天数干扰面板可见性判断。
  return Number(left?.year) === Number(right?.year) && Number(left?.month) === Number(right?.month);
}

function formatMonthLabel(month) {
  // 这里统一月份文案，供状态键和错误信息共用。
  return `${month.year}年${month.month}月`;
}

function buildPddCalendarStateKey(state) {
  // 这里把双月标题组合成稳定状态键，用于确认翻月已生效。
  return (state?.months || []).map((item) => formatMonthLabel(item)).join("|");
}

function isMonthVisibleInPddPanel(state, targetMonth) {
  // 这里判断目标月份是否已出现在双月面板中。
  return (state?.months || []).some((month) => isSameMonth(month, targetMonth));
}

module.exports = {
  toMonthIndex,
  toDateMonth,
  isSameMonth,
  formatMonthLabel,
  buildPddCalendarStateKey,
  isMonthVisibleInPddPanel
};
