function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeBoolean(value, defaultValue = true) {
  // 这里统一兼容网页端和 JSON 文件里的布尔值写法，避免启用状态被字符串污染。
  if (typeof value === "boolean") {
    return value;
  }

  const normalizedValue = normalizeString(value).toLowerCase();
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

module.exports = {
  normalizeString,
  normalizeBoolean
};
