const { normalizeBoolean, normalizeString } = require("./scalarNormalizers");

function buildStaffDirectoryFromLegacyMaps(
  memberMobileMap,
  memberUserIdMap,
  memberInlineMentionEnabledMap = {}
) {
  // 这里把旧版双映射折叠成单一成员清单，让控制台和磁盘配置以后都只维护一份人员源。
  const orderedNames = [];
  const nameSet = new Set();
  for (const staffName of Object.keys(memberMobileMap)) {
    if (!nameSet.has(staffName)) {
      orderedNames.push(staffName);
      nameSet.add(staffName);
    }
  }

  for (const staffName of Object.keys(memberUserIdMap)) {
    if (!nameSet.has(staffName)) {
      orderedNames.push(staffName);
      nameSet.add(staffName);
    }
  }

  return orderedNames.map((staffName) => ({
    name: staffName,
    mobile: normalizeString(memberMobileMap[staffName]),
    userId: normalizeString(memberUserIdMap[staffName]),
    inlineMentionEnabled: memberInlineMentionEnabledMap[staffName] !== false
  }));
}

function normalizeStaffDirectory(input, fallbackDirectory = []) {
  // 这里统一清洗成员清单结构，界面和磁盘都通过同一个数组模型维护人员信息。
  const sourceDirectory = Array.isArray(input) && input.length > 0 ? input : fallbackDirectory;
  const result = [];

  sourceDirectory.forEach((staff, index) => {
    if (!staff || typeof staff !== "object" || Array.isArray(staff)) {
      return;
    }

    const name = normalizeString(staff.name || staff.staffName);
    const mobile = normalizeString(staff.mobile || staff.phone || staff.memberMobile);
    const userId = normalizeString(staff.userId || staff.userid || staff.user_id || staff.memberUserId);
    const inlineMentionEnabled = normalizeBoolean(
      staff.inlineMentionEnabled ?? staff.inline_mention_enabled,
      true
    );
    if (!name && !mobile && !userId) {
      return;
    }

    result.push({
      id: normalizeString(staff.id) || `staff_${index + 1}`,
      name,
      mobile,
      userId,
      inlineMentionEnabled
    });
  });

  return result;
}

function buildMemberMobileMapFromStaffDirectory(staffDirectory) {
  // 这里从单一成员清单反推出手机号映射，继续兼容现有提醒引擎。
  const result = {};
  for (const staff of Array.isArray(staffDirectory) ? staffDirectory : []) {
    const name = normalizeString(staff?.name);
    if (!name) {
      continue;
    }

    result[name] = normalizeString(staff?.mobile);
  }

  return result;
}

function buildMemberUserIdMapFromStaffDirectory(staffDirectory) {
  // 这里从单一成员清单反推出 userid 映射，让行内 @ 能继续复用现有运行逻辑。
  const result = {};
  for (const staff of Array.isArray(staffDirectory) ? staffDirectory : []) {
    const name = normalizeString(staff?.name);
    if (!name) {
      continue;
    }

    const userId = normalizeString(staff?.userId);
    if (userId) {
      result[name] = userId;
    }
  }

  return result;
}

function buildMemberInlineMentionEnabledMapFromStaffDirectory(staffDirectory) {
  // 这里从单一成员清单反推出正文@开关映射，让运行时能统一决定是否启用行内 @。
  const result = {};
  for (const staff of Array.isArray(staffDirectory) ? staffDirectory : []) {
    const name = normalizeString(staff?.name);
    if (!name) {
      continue;
    }

    result[name] = staff?.inlineMentionEnabled !== false;
  }

  return result;
}

module.exports = {
  buildStaffDirectoryFromLegacyMaps,
  normalizeStaffDirectory,
  buildMemberMobileMapFromStaffDirectory,
  buildMemberUserIdMapFromStaffDirectory,
  buildMemberInlineMentionEnabledMapFromStaffDirectory
};
