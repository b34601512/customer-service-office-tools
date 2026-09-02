function normalizeStaffIdentityText(value) {
  // 这里统一清洗人员相关文本，避免空格和换行噪声把姓名、角色识别带偏。
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseStaffDisplayName(rawText) {
  // 这里统一拆成员姓名和角色，让页面解析、接口解析和提醒路由共用同一套口径。
  const normalizedText = normalizeStaffIdentityText(rawText).replace(/\s+我$/, "").trim();
  const bracketMatch = normalizedText.match(/^(.+?)（(.+?)）$/);
  if (bracketMatch) {
    return {
      memberName: bracketMatch[1].trim(),
      roleLabel: bracketMatch[2].trim()
    };
  }

  const segments = normalizedText.split(" ").filter(Boolean);
  if (segments.length >= 2) {
    return {
      memberName: segments[0].trim(),
      roleLabel: segments.slice(1).join(" ").trim()
    };
  }

  return {
    memberName: normalizedText,
    roleLabel: ""
  };
}

function parseStaffRoleGroup(rawRole) {
  // 这里把页面角色归一成固定业务分组，避免不同功能各自手写字符串判断。
  const normalizedRole = normalizeStaffIdentityText(rawRole);
  if (normalizedRole.includes("运营")) {
    return "operation";
  }

  if (normalizedRole.includes("售后")) {
    return "after_sales";
  }

  if (normalizedRole.includes("售前")) {
    return "pre_sales";
  }

  if (normalizedRole.includes("副经理")) {
    return "management";
  }

  return "";
}

module.exports = {
  normalizeStaffIdentityText,
  parseStaffDisplayName,
  parseStaffRoleGroup
};
