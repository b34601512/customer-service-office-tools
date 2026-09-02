const { normalizeBoolean, normalizeString } = require("./scalarNormalizers");

function normalizeMemberMobileMap(input) {
  // 这里统一清洗客服姓名和手机号映射，避免空值混入后续 @ 逻辑。
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return result;
  }

  for (const [staffName, mobile] of Object.entries(input)) {
    const normalizedStaffName = normalizeString(staffName);
    if (!normalizedStaffName) {
      continue;
    }

    result[normalizedStaffName] = normalizeString(mobile);
  }

  return result;
}

function normalizeMemberUserIdMap(input) {
  // 这里统一清洗客服姓名和企微 userid 映射，后续行内 @ 只认这份稳定配置。
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return result;
  }

  for (const [staffName, userId] of Object.entries(input)) {
    const normalizedStaffName = normalizeString(staffName);
    if (!normalizedStaffName) {
      continue;
    }

    result[normalizedStaffName] = normalizeString(userId);
  }

  return result;
}

function normalizeMemberInlineMentionEnabledMap(input) {
  // 这里统一清洗正文@开关映射，避免字符串布尔把运行时判断带偏。
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return result;
  }

  for (const [staffName, enabled] of Object.entries(input)) {
    const normalizedStaffName = normalizeString(staffName);
    if (!normalizedStaffName) {
      continue;
    }

    result[normalizedStaffName] = normalizeBoolean(enabled, true);
  }

  return result;
}

module.exports = {
  normalizeMemberMobileMap,
  normalizeMemberUserIdMap,
  normalizeMemberInlineMentionEnabledMap
};
