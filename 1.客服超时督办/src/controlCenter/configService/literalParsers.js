function parsePositiveInteger(value, fieldLabel) {
  // 这里强制要求正整数，避免把非法值静默写入生产参数。
  const normalizedValue = Number(value);
  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(`${fieldLabel} 只能填写大于 0 的整数。`);
  }

  return normalizedValue;
}

function parseBooleanLiteral(value, defaultValue = false) {
  // 这里统一解析 reply-config.js 里的布尔字面量，避免控制台读出字符串假布尔。
  if (value === "") {
    return defaultValue;
  }

  try {
    return Boolean(JSON.parse(value));
  } catch (error) {
    return defaultValue;
  }
}

function parseQuotedStringLiteral(value, fieldLabel, defaultValue = "") {
  // 这里统一解析 reply-config.js 里的字符串字面量，格式不对时直接抛中文错误。
  if (value === "") {
    return defaultValue;
  }

  try {
    return String(JSON.parse(value));
  } catch (error) {
    throw new Error(`${fieldLabel} 配置格式错误：${error.message}`);
  }
}

module.exports = {
  parsePositiveInteger,
  parseBooleanLiteral,
  parseQuotedStringLiteral
};
