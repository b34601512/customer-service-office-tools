// 该文件用于打开拼多多日期面板并把双月日历导航到目标月份。
const { formatDate } = require("../../../shared/exportDateRange");
const { clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const { getPddDateInput } = require("./pddDateInputState");
const { readPddDatePanelState, waitForPddDatePanelOpen } = require("./pddDatePanelState");
const { waitForNextPddDateStateCheck } = require("./pddDateStateWait");
const {
  toMonthIndex,
  toDateMonth,
  buildPddCalendarStateKey,
  isMonthVisibleInPddPanel
} = require("./pddCalendarMonth");

async function openPddDatePanel(page) {
  // 这里仅在面板未打开时点击日期范围控件。
  const currentState = await readPddDatePanelState(page);
  if (currentState?.open && currentState.months.length >= 2) {
    return currentState;
  }

  const input = getPddDateInput(page);
  await clickLocatorWhenReady(input, "拼多多日期范围控件", { timeoutMs: 5000 });
  return waitForPddDatePanelOpen(page);
}

async function clickPddCalendarArrow(page, direction) {
  // 这里按方向点击拼多多日期面板的唯一翻月箭头。
  const isPrevious = direction === "previous";
  const selector = isPrevious
    ? "i[class*='RPR_iconPrevNext'][class*='ICN_type-left']:visible"
    : "i[class*='RPR_iconPrevNext'][class*='ICN_type-right']:visible";
  const locator = page.locator(selector).first();
  await clickLocatorWhenReady(locator, isPrevious ? "拼多多日期上月按钮" : "拼多多日期下月按钮", {
    timeoutMs: 5000
  });
}

async function waitForPddCalendarStateChanged(page, previousKey, timeoutMs = 10000) {
  // 这里等待双月标题变化，确认翻月动作已真实生效。
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 10000);
  while (Date.now() <= deadline) {
    const state = await readPddDatePanelState(page);
    if (state?.open && buildPddCalendarStateKey(state) && buildPddCalendarStateKey(state) !== previousKey) {
      return state;
    }

    await waitForNextPddDateStateCheck(deadline);
  }

  throw new Error("拼多多日期面板翻月后月份没有变化。");
}

async function navigatePddCalendarToVisibleRange(page, startDate, endDate) {
  // 这里按左右两个月是否覆盖目标区间来翻页，逻辑和原下载链路保持一致。
  const targetStartMonth = toDateMonth(startDate);
  const targetEndMonth = toDateMonth(endDate);
  let guard = 0;

  while (guard < 36) {
    const state = await waitForPddDatePanelOpen(page);
    if (isMonthVisibleInPddPanel(state, targetStartMonth) && isMonthVisibleInPddPanel(state, targetEndMonth)) {
      return state;
    }

    const firstMonth = state.months[0];
    const lastMonth = state.months[state.months.length - 1];
    const shouldGoPrevious =
      toMonthIndex(targetStartMonth.year, targetStartMonth.month) < toMonthIndex(firstMonth.year, firstMonth.month) ||
      toMonthIndex(targetEndMonth.year, targetEndMonth.month) < toMonthIndex(firstMonth.year, firstMonth.month);
    const previousKey = buildPddCalendarStateKey(state);
    await clickPddCalendarArrow(page, shouldGoPrevious ? "previous" : "next");
    await waitForPddCalendarStateChanged(page, previousKey);
    guard += 1;

    if (!shouldGoPrevious && toMonthIndex(targetStartMonth.year, targetStartMonth.month) <= toMonthIndex(lastMonth.year, lastMonth.month)) {
      continue;
    }
  }

  throw new Error(`拼多多日期面板切月次数异常，未能定位到 ${formatDate(startDate)} 到 ${formatDate(endDate)} 的可见月份。`);
}

module.exports = {
  openPddDatePanel,
  clickPddCalendarArrow,
  waitForPddCalendarStateChanged,
  navigatePddCalendarToVisibleRange
};
