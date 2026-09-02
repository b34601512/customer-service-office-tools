const OFF_DUTY_DEFAULT_SCAN_INTERVAL_MS = 5 * 60 * 1000;
const OFF_DUTY_MODE_NAME = "下班监控=排班驱动";
const OFF_DUTY_PROMPT_TRACE =
  "排班驱动：不在上班时间窗内自动关闭「自动分配/是否可被转接」；一律不自动释放对话，保留会话待人工确认";

function normalizeBoolean(value, defaultValue = false) {
  // 这里统一兼容布尔型配置，避免网页保存时被字符串污染后直接读错。
  if (typeof value === "boolean") {
    return value;
  }

  const normalizedValue = String(value || "").trim().toLowerCase();
  if (!normalizedValue) {
    return defaultValue;
  }

  if (["true", "1", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return defaultValue;
}

function normalizePositiveNumber(value, defaultValue) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : defaultValue;
}

function normalizeOptionalString(value, defaultValue = "") {
  return String(value || "").trim() || defaultValue;
}

function normalizeTimeText(value, defaultValue) {
  // 这里强制约束时间配置格式，避免把无效时间静默写进生产规则。
  const normalizedValue = normalizeOptionalString(value, defaultValue);
  if (!/^\d{2}:\d{2}$/.test(normalizedValue)) {
    throw new Error(`时间格式错误：${normalizedValue}，请使用 HH:mm。`);
  }

  const [hourText, minuteText] = normalizedValue.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`时间值无效：${normalizedValue}，请使用 00:00 到 23:59。`);
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function buildOffDutyConfig(input = {}) {
  // 这里统一收口下班监控配置，确保运行时和控制台读取的是同一套字段口径。
  return {
    offDutyAutomationEnabled: normalizeBoolean(input.offDutyAutomationEnabled, true),
    offDutyScanIntervalMs: normalizePositiveNumber(
      input.offDutyScanIntervalMs,
      OFF_DUTY_DEFAULT_SCAN_INTERVAL_MS
    ),
    offDutyPreSalesEarlyStartTime: normalizeTimeText(input.offDutyPreSalesEarlyStartTime, "08:00"),
    offDutyPreSalesLateStartTime: normalizeTimeText(input.offDutyPreSalesLateStartTime, "15:45"),
    offDutyAfterSalesEarlyStartTime: normalizeTimeText(input.offDutyAfterSalesEarlyStartTime, "08:00"),
    offDutyAfterSalesLateStartTime: normalizeTimeText(input.offDutyAfterSalesLateStartTime, "14:00"),
    offDutyPreSalesEarlyCloseTime: normalizeTimeText(input.offDutyPreSalesEarlyCloseTime, "16:30"),
    offDutyPreSalesLateCloseTime: normalizeTimeText(input.offDutyPreSalesLateCloseTime, "23:45"),
    offDutyAfterSalesEarlyCloseTime: normalizeTimeText(input.offDutyAfterSalesEarlyCloseTime, "16:30"),
    offDutyAfterSalesLateCloseTime: normalizeTimeText(input.offDutyAfterSalesLateCloseTime, "22:30"),
    offDutyTomorrowShiftNotificationEnabled: normalizeBoolean(
      input.offDutyTomorrowShiftNotificationEnabled,
      false
    )
  };
}

function parseTimeTextToDate(baseDate, timeText) {
  // 这里把 HH:mm 配置转换成当天绝对时间，后续所有到点判断都只认这个结果。
  const normalizedTimeText = normalizeTimeText(timeText, timeText);
  const [hourText, minuteText] = normalizedTimeText.split(":");
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    Number(hourText),
    Number(minuteText),
    0,
    0
  );
}

function resolveShiftStage(shiftLabel) {
  // 这里把排班结果压成早晚休三类，避免上层直接拿中文文案分支。
  const normalizedShift = String(shiftLabel || "").trim();
  if (normalizedShift === "早班") {
    return "early";
  }

  if (normalizedShift === "晚班") {
    return "late";
  }

  return "off";
}

function resolveOffDutyStartTime(config, staffGroup, shiftLabel) {
  // 这里根据客服分组和班次决定上班开始时间；不在上班时间窗内（含上班前）就属于不在班。
  const shiftStage = resolveShiftStage(shiftLabel);
  if (staffGroup === "pre_sales" && shiftStage === "early") {
    return config.offDutyPreSalesEarlyStartTime;
  }

  if (staffGroup === "pre_sales" && shiftStage === "late") {
    return config.offDutyPreSalesLateStartTime;
  }

  if (staffGroup === "after_sales" && shiftStage === "early") {
    return config.offDutyAfterSalesEarlyStartTime;
  }

  if (staffGroup === "after_sales" && shiftStage === "late") {
    return config.offDutyAfterSalesLateStartTime;
  }

  return "";
}

function resolveOffDutyCloseTime(config, staffGroup, shiftLabel) {
  // 这里根据客服分组和班次决定到点时间，所有下班规则都复用同一个入口。
  const shiftStage = resolveShiftStage(shiftLabel);
  if (staffGroup === "pre_sales" && shiftStage === "early") {
    return config.offDutyPreSalesEarlyCloseTime;
  }

  if (staffGroup === "pre_sales" && shiftStage === "late") {
    return config.offDutyPreSalesLateCloseTime;
  }

  if (staffGroup === "after_sales" && shiftStage === "early") {
    return config.offDutyAfterSalesEarlyCloseTime;
  }

  if (staffGroup === "after_sales" && shiftStage === "late") {
    return config.offDutyAfterSalesLateCloseTime;
  }

  return "";
}

function formatShiftForDisplay(shiftLabel) {
  // 这里统一处理班次展示文案，后台和群通知都走同一套文本。
  const normalizedShift = String(shiftLabel || "").trim();
  return normalizedShift || "休息";
}

module.exports = {
  OFF_DUTY_DEFAULT_SCAN_INTERVAL_MS,
  OFF_DUTY_MODE_NAME,
  OFF_DUTY_PROMPT_TRACE,
  buildOffDutyConfig,
  formatShiftForDisplay,
  normalizeBoolean,
  normalizeOptionalString,
  normalizePositiveNumber,
  normalizeTimeText,
  parseTimeTextToDate,
  resolveOffDutyCloseTime,
  resolveOffDutyStartTime,
  resolveShiftStage
};
