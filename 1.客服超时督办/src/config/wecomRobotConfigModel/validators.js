const { normalizeString } = require("./scalarNormalizers");
const { normalizeStaffDirectory } = require("./staffDirectory");

function validateNotificationGroups(notificationGroups) {
  // 这里在保存前强制校验每个通知群，避免把残缺行静默写进生产配置。
  notificationGroups.forEach((group, index) => {
    if (!normalizeString(group.webhookUrl)) {
      throw new Error(`第 ${index + 1} 个通知群未填写 webhook。`);
    }
  });

  return notificationGroups;
}

function validateStaffDirectory(staffDirectory) {
  // 这里在保存前强制校验成员清单，避免出现重名、空姓名和空联系方式这种生产黑箱。
  const normalizedDirectory = normalizeStaffDirectory(staffDirectory);
  const usedNameSet = new Set();

  normalizedDirectory.forEach((staff, index) => {
    if (!staff.name) {
      throw new Error(`第 ${index + 1} 个成员未填写姓名。`);
    }

    if (!staff.mobile && !staff.userId) {
      throw new Error(`成员「${staff.name}」至少要填写手机号或企微 userid。`);
    }

    if (usedNameSet.has(staff.name)) {
      throw new Error(`成员姓名重复：${staff.name}。请先合并成一条再保存。`);
    }

    usedNameSet.add(staff.name);
  });

  return normalizedDirectory;
}

module.exports = {
  validateNotificationGroups,
  validateStaffDirectory
};
