const {
  formatDate,
  resolveDefaultCompletedExportDateRange
} = require("../shared/exportDateRange");

function resolveDefaultSummaryDateRange(baseDate = new Date()) {
  // 无显式店铺日期时，汇总流程复用全局默认的月初起和2天延迟。
  const resolvedRange = resolveDefaultCompletedExportDateRange(baseDate);
  return {
    ...resolvedRange,
    mode: "rolling_completed_days"
  };
}

module.exports = {
  formatDate,
  resolveDefaultSummaryDateRange
};
