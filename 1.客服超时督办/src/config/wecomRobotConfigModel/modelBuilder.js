const { normalizeString } = require("./scalarNormalizers");
const {
  normalizeMemberMobileMap,
  normalizeMemberUserIdMap,
  normalizeMemberInlineMentionEnabledMap
} = require("./legacyMemberMaps");
const {
  buildStaffDirectoryFromLegacyMaps,
  normalizeStaffDirectory,
  buildMemberMobileMapFromStaffDirectory,
  buildMemberUserIdMapFromStaffDirectory,
  buildMemberInlineMentionEnabledMapFromStaffDirectory
} = require("./staffDirectory");
const {
  createLegacyNotificationGroups,
  normalizeNotificationGroups,
  resolveLegacyCompatibleWebhookUrls
} = require("./notificationGroups");
const { validateNotificationGroups, validateStaffDirectory } = require("./validators");

function buildWecomRobotConfigModel(input) {
  // 这里统一把磁盘配置转换成前后端共用模型，避免多个入口各自兼容旧字段。
  const legacyNotificationGroups = createLegacyNotificationGroups(input);
  const notificationGroups = normalizeNotificationGroups(
    input?.notification_groups,
    legacyNotificationGroups
  );
  const legacyCompatibleWebhookUrls = resolveLegacyCompatibleWebhookUrls(notificationGroups);
  const memberMobileMap = normalizeMemberMobileMap(input?.member_mobile_map);
  const memberUserIdMap = normalizeMemberUserIdMap(input?.member_userid_map);
  const memberInlineMentionEnabledMap = normalizeMemberInlineMentionEnabledMap(
    input?.member_inline_mention_enabled_map
  );
  const staffDirectory = normalizeStaffDirectory(
    input?.member_directory,
    buildStaffDirectoryFromLegacyMaps(
      memberMobileMap,
      memberUserIdMap,
      memberInlineMentionEnabledMap
    )
  );
  const resolvedMemberMobileMap = buildMemberMobileMapFromStaffDirectory(staffDirectory);
  const resolvedMemberUserIdMap = buildMemberUserIdMapFromStaffDirectory(staffDirectory);
  const resolvedMemberInlineMentionEnabledMap =
    buildMemberInlineMentionEnabledMapFromStaffDirectory(staffDirectory);

  return {
    preSalesWebhookUrl:
      legacyCompatibleWebhookUrls.preSalesWebhookUrl || normalizeString(input?.pre_sales_webhook_url),
    afterSalesWebhookUrl:
      legacyCompatibleWebhookUrls.afterSalesWebhookUrl ||
      normalizeString(input?.after_sales_webhook_url) ||
      legacyCompatibleWebhookUrls.preSalesWebhookUrl,
    notificationGroups,
    staffDirectory,
    memberMobileMap: resolvedMemberMobileMap,
    memberUserIdMap: resolvedMemberUserIdMap,
    memberInlineMentionEnabledMap: resolvedMemberInlineMentionEnabledMap
  };
}

function buildPersistedWecomRobotConfig(input) {
  // 这里统一把网页提交结果转换成磁盘 JSON，确保新列表结构和旧字段一起持久化。
  const notificationGroups = validateNotificationGroups(
    normalizeNotificationGroups(input?.notificationGroups)
  );
  const fallbackStaffDirectory = buildStaffDirectoryFromLegacyMaps(
    normalizeMemberMobileMap(input?.memberMobileMap),
    normalizeMemberUserIdMap(input?.memberUserIdMap),
    normalizeMemberInlineMentionEnabledMap(input?.memberInlineMentionEnabledMap)
  );
  const staffDirectory = validateStaffDirectory(
    normalizeStaffDirectory(input?.staffDirectory, fallbackStaffDirectory)
  );
  const legacyCompatibleWebhookUrls = resolveLegacyCompatibleWebhookUrls(notificationGroups);
  const memberMobileMap = buildMemberMobileMapFromStaffDirectory(staffDirectory);
  const memberUserIdMap = buildMemberUserIdMapFromStaffDirectory(staffDirectory);
  const memberInlineMentionEnabledMap =
    buildMemberInlineMentionEnabledMapFromStaffDirectory(staffDirectory);

  return {
    pre_sales_webhook_url: legacyCompatibleWebhookUrls.preSalesWebhookUrl,
    after_sales_webhook_url: legacyCompatibleWebhookUrls.afterSalesWebhookUrl,
    notification_groups: notificationGroups.map((group) => ({
      id: group.id,
      name: group.name,
      webhook_url: group.webhookUrl,
      enabled: group.enabled
    })),
    member_directory: staffDirectory.map((staff) => ({
      name: staff.name,
      mobile: staff.mobile,
      user_id: staff.userId,
      inline_mention_enabled: staff.inlineMentionEnabled !== false
    })),
    member_mobile_map: memberMobileMap,
    member_userid_map: memberUserIdMap,
    member_inline_mention_enabled_map: memberInlineMentionEnabledMap
  };
}

module.exports = {
  buildWecomRobotConfigModel,
  buildPersistedWecomRobotConfig
};
