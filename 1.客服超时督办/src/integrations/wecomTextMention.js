function normalizeMappedValue(map, staffName) {
  // 这里统一清洗姓名映射结果，避免空格和空值让行内@判断失真。
  const normalizedStaffName = String(staffName || "").trim();
  if (!normalizedStaffName || !map || typeof map !== "object" || Array.isArray(map)) {
    return "";
  }

  return String(map[normalizedStaffName] || "").trim();
}

function buildInlineMentionToken(staffName, memberUserIdMap) {
  // 这里优先输出企微官方支持的 <@userid> 行内艾特语法，便于去掉底部重复 @。
  const userId = normalizeMappedValue(memberUserIdMap, staffName);
  return userId ? `<@${userId}>` : "";
}

function isInlineMentionEnabled(staffName, memberInlineMentionEnabledMap) {
  // 这里统一判断某个人是否启用正文 @，避免上下游各自拼开关默认值。
  const normalizedStaffName = String(staffName || "").trim();
  if (!normalizedStaffName) {
    return false;
  }

  if (
    !memberInlineMentionEnabledMap ||
    typeof memberInlineMentionEnabledMap !== "object" ||
    Array.isArray(memberInlineMentionEnabledMap)
  ) {
    return true;
  }

  return memberInlineMentionEnabledMap[normalizedStaffName] !== false;
}

function resolveMentionPlan(staffNames, options = {}) {
  // 这里统一决定每个人走行内@还是底部手机号@，避免上下游消息各写一套分流逻辑。
  const mobileOnlyNameSet = new Set(
    (Array.isArray(options.mobileOnlyStaffNames) ? options.mobileOnlyStaffNames : [])
      .map((staffName) => String(staffName || "").trim())
      .filter(Boolean)
  );
  const inlineMentionTokenMap = {};
  const mentionedMobileList = [];
  const uniqueStaffNames = Array.from(
    new Set(
      (Array.isArray(staffNames) ? staffNames : [])
        .map((staffName) => String(staffName || "").trim())
        .filter(Boolean)
    )
  );

  for (const staffName of uniqueStaffNames) {
    const inlineMentionToken =
      mobileOnlyNameSet.has(staffName) || !isInlineMentionEnabled(staffName, options.memberInlineMentionEnabledMap)
      ? ""
      : buildInlineMentionToken(staffName, options.memberUserIdMap);
    if (inlineMentionToken) {
      inlineMentionTokenMap[staffName] = inlineMentionToken;
      continue;
    }

    const mobile = normalizeMappedValue(options.memberMobileMap, staffName);
    if (mobile) {
      mentionedMobileList.push(mobile);
    }
  }

  return {
    inlineMentionTokenMap,
    mentionedMobileList: Array.from(new Set(mentionedMobileList))
  };
}

module.exports = {
  buildInlineMentionToken,
  resolveMentionPlan
};
