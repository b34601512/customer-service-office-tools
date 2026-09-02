function normalizeString(value) {
  return String(value || "").trim();
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeInteger(value, fallbackValue = 0) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) ? numberValue : Number(fallbackValue || 0);
}

const MAX_EXPORT_DATE_AUTOMATION_DAY_COUNT = 3650;
const EXPORT_DATE_MODES = ["automatic", "manual"];

function validateExportDateMode(exportDateMode, fallbackExportDateMode = "automatic") {
  // 该函数只接受智能或手动两种总下载日期模式。
  const normalizedMode = normalizeString(exportDateMode || fallbackExportDateMode || "automatic");
  if (!EXPORT_DATE_MODES.includes(normalizedMode)) {
    throw new Error(`下载日期模式不支持：${normalizedMode}`);
  }
  return normalizedMode;
}

function createDefaultExportDateAutomationConfig() {
  // 智能模式起始固定为月初，只需保留平台数据延迟天数。
  return {
    endDateDelayDayCount: 2
  };
}

function validateExportDateAutomationInteger(value, fallbackValue, minimumValue, label) {
  // 该函数只校验一个日期自动化整数，避免超大日期让平台日历失效。
  const candidateValue = value === undefined || value === null || value === ""
    ? Number(fallbackValue)
    : Number(value);
  if (
    !Number.isInteger(candidateValue) ||
    candidateValue < minimumValue ||
    candidateValue > MAX_EXPORT_DATE_AUTOMATION_DAY_COUNT
  ) {
    throw new Error(`${label}必须是 ${minimumValue} 至 ${MAX_EXPORT_DATE_AUTOMATION_DAY_COUNT} 的整数。`);
  }
  return candidateValue;
}

function validateExportDateAutomationConfig(dateAutomationConfig, fallbackDateAutomationConfig) {
  // 该函数只把全店日期自动化参数校验成统一结构，兼容仍带旧 dateRangeDayCount 的配置。
  const defaultConfig = createDefaultExportDateAutomationConfig();
  const fallbackConfig = fallbackDateAutomationConfig || defaultConfig;
  return {
    endDateDelayDayCount: validateExportDateAutomationInteger(
      dateAutomationConfig?.endDateDelayDayCount,
      fallbackConfig.endDateDelayDayCount ?? defaultConfig.endDateDelayDayCount,
      0,
      "结束日期延迟天数"
    )
  };
}

function shiftDate(date, offsetDays) {
  const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  nextDate.setDate(nextDate.getDate() + offsetDays);
  return nextDate;
}

function parseDateText(dateText, label) {
  const safeDateText = normalizeString(dateText);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDateText)) {
    throw new Error(`${label} 必须是 YYYY-MM-DD 格式。`);
  }

  const [yearText, monthText, dayText] = safeDateText.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(`${label} 不是合法日期。`);
  }

  return date;
}

function createDatePointConfig(type, offsetDays = 0, customDate = "") {
  return {
    type,
    offsetDays,
    customDate
  };
}

function createExportDateRangeConfig(options = {}) {
  return {
    start: createDatePointConfig(
      options.startType || "month_start",
      options.startOffsetDays || 0,
      options.startCustomDate || ""
    ),
    end: createDatePointConfig(
      options.endType || "today",
      options.endOffsetDays ?? 0,
      options.endCustomDate || ""
    )
  };
}

function createManualExportDateRangeConfig(startCustomDate = "", endCustomDate = "") {
  return createExportDateRangeConfig({
    startType: "custom_date",
    startOffsetDays: 0,
    startCustomDate,
    endType: "custom_date",
    endOffsetDays: 0,
    endCustomDate
  });
}

function resolveAutomatedExportDateRange(dateAutomationConfig, baseDate = new Date()) {
  // 智能模式起始固定为本月1号；若结束日已跨入上月则锚定到结束日所在月份，避免开始晚于结束。
  const normalizedConfig = validateExportDateAutomationConfig(dateAutomationConfig);
  const endDate = shiftDate(baseDate, -normalizedConfig.endDateDelayDayCount);
  const anchorDate = endDate < getMonthStart(baseDate) ? endDate : baseDate;
  const startDate = getMonthStart(anchorDate);
  return {
    startDate,
    endDate,
    startText: formatDate(startDate),
    endText: formatDate(endDate)
  };
}

function createAutomatedExportDateRangeConfig(dateAutomationConfig, baseDate = new Date()) {
  const resolvedRange = resolveAutomatedExportDateRange(dateAutomationConfig, baseDate);
  return createManualExportDateRangeConfig(resolvedRange.startText, resolvedRange.endText);
}

function resolveDefaultCompletedExportDateRange(baseDate = new Date()) {
  return resolveAutomatedExportDateRange(createDefaultExportDateAutomationConfig(), baseDate);
}

function createDefaultCompletedExportDateRangeConfig(baseDate = new Date()) {
  return createAutomatedExportDateRangeConfig(createDefaultExportDateAutomationConfig(), baseDate);
}

function validateDatePoint(pointConfig, fallbackPointConfig, label) {
  const safeFallback = fallbackPointConfig || createDatePointConfig("today", 0, "");
  const pointType = normalizeString(pointConfig?.type || safeFallback.type || "today");
  const allowedTypes = ["month_start", "today", "custom_date"];

  if (!allowedTypes.includes(pointType)) {
    throw new Error(`${label} 类型不支持：${pointType}`);
  }

  const normalizedPoint = {
    type: pointType,
    offsetDays: normalizeInteger(pointConfig?.offsetDays, safeFallback.offsetDays),
    customDate: normalizeString(pointConfig?.customDate || safeFallback.customDate)
  };

  if (normalizedPoint.type === "custom_date" && !normalizedPoint.customDate) {
    throw new Error(`${label} 选择固定日期时，日期不能为空。`);
  }

  if (normalizedPoint.customDate) {
    parseDateText(normalizedPoint.customDate, `${label} 固定日期`);
  }

  return normalizedPoint;
}

function validateExportDateRange(dateRangeConfig, fallbackDateRangeConfig, label) {
  const safeFallback =
    fallbackDateRangeConfig ||
    createExportDateRangeConfig({
      startType: "month_start",
      startOffsetDays: 0,
      endType: "today",
      endOffsetDays: -1
    });

  return {
    start: validateDatePoint(dateRangeConfig?.start, safeFallback.start, `${label} 开始日期规则`),
    end: validateDatePoint(dateRangeConfig?.end, safeFallback.end, `${label} 结束日期规则`)
  };
}

function resolveDatePoint(pointConfig, baseDate, label) {
  // 这里把“今天、月初、固定日期”统一解析成真实日期，后面平台下载只认标准日期对象。
  if (pointConfig.type === "custom_date") {
    return shiftDate(parseDateText(pointConfig.customDate, `${label} 固定日期`), pointConfig.offsetDays);
  }

  if (pointConfig.type === "month_start") {
    const startOfMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    return shiftDate(startOfMonth, pointConfig.offsetDays);
  }

  return shiftDate(new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()), pointConfig.offsetDays);
}

function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function resolveExportDateRange(dateRangeConfig, baseDate = new Date()) {
  // 这里统一产出导出区间，所有平台后续都可以复用同一套规则引擎。
  const normalizedConfig = validateExportDateRange(dateRangeConfig, dateRangeConfig, "导出日期");
  const endDate = resolveDatePoint(normalizedConfig.end, baseDate, "结束日期");
  const currentMonthStart = getMonthStart(baseDate);
  const shouldAnchorMonthStartToEndMonth =
    normalizedConfig.start.type === "month_start" && endDate < currentMonthStart;
  const startAnchorDate = shouldAnchorMonthStartToEndMonth ? endDate : baseDate;
  const startDate = resolveDatePoint(normalizedConfig.start, startAnchorDate, "开始日期");

  if (endDate < startDate) {
    throw new Error(`导出日期配置错误：结束日期 ${formatDate(endDate)} 早于开始日期 ${formatDate(startDate)}。`);
  }

  const result = {
    startDate,
    endDate,
    startText: formatDate(startDate),
    endText: formatDate(endDate)
  };

  if (shouldAnchorMonthStartToEndMonth) {
    result.ruleNotice = `结束日期已跨月，月初规则已自动锚定到 ${formatDate(getMonthStart(endDate))} 所在月份。`;
  }

  return result;
}

function resolveExportDateRangeToManualConfig(
  dateRangeConfig,
  fallbackDateRangeConfig,
  label = "导出日期",
  baseDate = new Date()
) {
  // 这里把历史上的自动日期规则收口成固定日期，保证前端手填什么后台就执行什么。
  const validatedConfig = validateExportDateRange(dateRangeConfig, fallbackDateRangeConfig, label);
  const resolvedRange = resolveExportDateRange(validatedConfig, baseDate);
  return createManualExportDateRangeConfig(resolvedRange.startText, resolvedRange.endText);
}

module.exports = {
  validateExportDateMode,
  createExportDateRangeConfig,
  createManualExportDateRangeConfig,
  createDefaultExportDateAutomationConfig,
  validateExportDateAutomationConfig,
  resolveAutomatedExportDateRange,
  createAutomatedExportDateRangeConfig,
  createDefaultCompletedExportDateRangeConfig,
  resolveDefaultCompletedExportDateRange,
  resolveExportDateRange,
  resolveExportDateRangeToManualConfig,
  formatDate
};
