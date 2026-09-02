// 该文件用于保持拼多多日期应用的稳定对外入口，并只组合各职责模块的公开能力。
const { applyPddDateRange } = require("./pddDateRangeWorkflow");
const { waitForPddDateRangeApplied } = require("./pddDateInputState");
const { normalizePddDateRangeText, isPddDateRangeTextMatched } = require("./pddDateText");
const { toMonthIndex, isSameMonth, buildPddCalendarStateKey } = require("./pddCalendarMonth");
const {
  isPddActiveLoadingSignal,
  readPddReportLoadingState,
  isPddReportDataText,
  isPddReportReadyState
} = require("./pddReportState");
const { isPddDatePanelClosedState } = require("./pddDatePanelState");

module.exports = {
  applyPddDateRange,
  waitForPddDateRangeApplied,
  __test__: {
    normalizePddDateRangeText,
    isPddDateRangeTextMatched,
    toMonthIndex,
    isSameMonth,
    buildPddCalendarStateKey,
    waitForPddDateRangeApplied,
    isPddActiveLoadingSignal,
    readPddReportLoadingState,
    isPddReportDataText,
    isPddReportReadyState,
    isPddDatePanelClosedState
  }
};
