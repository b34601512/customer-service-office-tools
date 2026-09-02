const { createExportDateRangeConfig, resolveExportDateRange } = require("../../shared/exportDateRange");

function createDefaultTmallExportDateRange() {
  return createExportDateRangeConfig({
    startType: "month_start",
    startOffsetDays: 0,
    endType: "today",
    endOffsetDays: -2
  });
}

function resolveTmallDateRange(storeConfig, baseDate = new Date()) {
  const dateRangeConfig = storeConfig?.exportDateRange || createDefaultTmallExportDateRange();
  return resolveExportDateRange(dateRangeConfig, baseDate);
}

function resolveMonthlyCompletedRange(baseDate = new Date()) {
  const dateRangeConfig = createExportDateRangeConfig({
    startType: "month_start",
    startOffsetDays: 0,
    endType: "today",
    endOffsetDays: -2
  });
  return resolveExportDateRange(dateRangeConfig, baseDate);
}

module.exports = {
  resolveTmallDateRange,
  resolveMonthlyCompletedRange
};
