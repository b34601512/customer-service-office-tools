const { normalizeBoolean, normalizeString } = require("./scalarNormalizers");

function createLegacyNotificationGroups(input) {
  // 这里把旧版售前/售后双字段自动迁移成通知群列表，升级后台后不丢历史配置。
  const preSalesWebhookUrl = normalizeString(input?.pre_sales_webhook_url);
  const afterSalesWebhookUrl = normalizeString(input?.after_sales_webhook_url);
  if (!preSalesWebhookUrl && !afterSalesWebhookUrl) {
    return [];
  }

  if (
    preSalesWebhookUrl &&
    afterSalesWebhookUrl &&
    preSalesWebhookUrl === afterSalesWebhookUrl
  ) {
    return [
      {
        id: "legacy_shared",
        name: "统一通知群",
        webhookUrl: preSalesWebhookUrl,
        enabled: true
      }
    ];
  }

  const groups = [];
  if (preSalesWebhookUrl) {
    groups.push({
      id: "legacy_pre_sales",
      name: "售前群",
      webhookUrl: preSalesWebhookUrl,
      enabled: true
    });
  }

  if (afterSalesWebhookUrl) {
    groups.push({
      id: "legacy_after_sales",
      name: "售后群",
      webhookUrl: afterSalesWebhookUrl,
      enabled: true
    });
  }

  return groups;
}

function normalizeNotificationGroups(input, fallbackGroups = []) {
  // 这里统一兼容新旧通知群结构，保证控制台和运行时都拿到同一种数组模型。
  const sourceGroups = Array.isArray(input) && input.length > 0 ? input : fallbackGroups;
  const result = [];

  sourceGroups.forEach((group, index) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      return;
    }

    const name = normalizeString(group.name || group.label || group.remark || group.note);
    const webhookUrl = normalizeString(group.webhookUrl || group.webhook_url);
    const enabled = normalizeBoolean(group.enabled, true);
    const id = normalizeString(group.id || group.key) || `notification_group_${index + 1}`;
    if (!name && !webhookUrl) {
      return;
    }

    result.push({
      id,
      name: name || `通知群${result.length + 1}`,
      webhookUrl,
      enabled
    });
  });

  return result;
}

function resolveLegacyCompatibleWebhookUrls(notificationGroups) {
  // 这里继续回写旧版双字段，保证老配置和新列表结构始终能互相兼容。
  const availableWebhookUrls = notificationGroups
    .map((group) => normalizeString(group.webhookUrl))
    .filter(Boolean);
  const primaryWebhookUrl = availableWebhookUrls[0] || "";
  const secondaryWebhookUrl = availableWebhookUrls[1] || primaryWebhookUrl;
  return {
    preSalesWebhookUrl: primaryWebhookUrl,
    afterSalesWebhookUrl: secondaryWebhookUrl
  };
}

module.exports = {
  createLegacyNotificationGroups,
  normalizeNotificationGroups,
  resolveLegacyCompatibleWebhookUrls
};
