function normalizeTimestampObject(value) {
  // 这里兼容对象时间戳，避免平台未来换成 seconds/nanos 后整条消息被丢掉。
  if (!value || typeof value !== "object") {
    return 0;
  }

  const seconds = Number(value.seconds ?? value._seconds ?? value.sec);
  if (Number.isFinite(seconds) && seconds > 0) {
    const millis = Number(value.milliseconds ?? value.millis ?? value.ms ?? 0);
    return Math.floor(seconds * 1000 + (Number.isFinite(millis) ? millis : 0));
  }

  return normalizeTimestamp(value.value ?? value.time ?? value.timestamp ?? value.date);
}

function normalizeTimestamp(value) {
  // 这里统一把秒级、毫秒级和可解析日期压成毫秒时间戳。
  if (value && typeof value === "object") {
    return normalizeTimestampObject(value);
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue < 10000000000 ? Math.floor(numericValue * 1000) : Math.floor(numericValue);
  }

  const parsedDate = new Date(String(value || "").trim());
  return Number.isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime();
}

module.exports = {
  normalizeTimestamp
};
