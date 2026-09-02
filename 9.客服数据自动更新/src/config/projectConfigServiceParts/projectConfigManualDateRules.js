const { normalizeString } = require("./projectConfigValuePrimitives");

function isManualDatePoint(pointConfig) {
  // 这个函数只判断一个日期点是否已固定为无偏移的明确日期。
  return Boolean(
    pointConfig &&
      normalizeString(pointConfig.type) === "custom_date" &&
      Number(pointConfig.offsetDays || 0) === 0 &&
      normalizeString(pointConfig.customDate)
  );
}

function isManualDateRange(exportDateRange) {
  // 这个函数只判断起止日期是否都已固定为手动日期。
  return Boolean(
    exportDateRange &&
      isManualDatePoint(exportDateRange.start) &&
      isManualDatePoint(exportDateRange.end)
  );
}

module.exports = {
  isManualDatePoint,
  isManualDateRange
};
