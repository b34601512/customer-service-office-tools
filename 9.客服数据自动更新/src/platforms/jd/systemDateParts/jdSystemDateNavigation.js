const { formatDate } = require("../../../shared/exportDateRange");
const { clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const { pickVisibleJdLocator } = require("../dateStateParts/jdVisibleLocator");
const {
  calculateJdSystemMonthShift,
  isJdSystemMonthVisible
} = require("./jdSystemDateMonth");
const {
  readJdSystemPanelMonths,
  waitForJdSystemPanelMonthsChanged
} = require("./jdSystemDatePanel");

async function clickJdSystemMonthShift(panel, direction) {
  // 这个函数只点击一次系统日期面板的上月或下月按钮。
  const isPreviousMonth = direction === "prevMonth";
  const selector = isPreviousMonth
    ? ".kf-manage-lite-picker-header-prev-btn"
    : ".kf-manage-lite-picker-header-next-btn";
  const button = await pickVisibleJdLocator(panel.locator(selector));
  if (!button) {
    throw new Error(`京东系统日期面板缺少可点击的${isPreviousMonth ? "上月" : "下月"}按钮。`);
  }
  await clickLocatorWhenReady(button, isPreviousMonth ? "京东系统日期上月按钮" : "京东系统日期下月按钮", {
    timeoutMs: 5000
  });
}

async function navigateJdSystemCalendar(panel, startDate, endDate) {
  // 这个函数只把左右月份面板移动到同时覆盖目标日期区间。
  let shiftCount = 0;
  while (shiftCount < 36) {
    const months = await readJdSystemPanelMonths(panel);
    if (isJdSystemMonthVisible(months, startDate) && isJdSystemMonthVisible(months, endDate)) {
      return months;
    }
    const startShift = calculateJdSystemMonthShift(months.left, startDate);
    const endShift = calculateJdSystemMonthShift(months.right, endDate);
    const direction = startShift < 0 || endShift < 0 ? "prevMonth" : "nextMonth";
    await clickJdSystemMonthShift(panel, direction);
    await waitForJdSystemPanelMonthsChanged(panel, months);
    shiftCount += 1;
  }
  throw new Error(
    `京东系统日期面板切月次数异常，未能定位到 ${formatDate(startDate)} 到 ${formatDate(endDate)} 的可见月份。`
  );
}

module.exports = {
  navigateJdSystemCalendar
};
