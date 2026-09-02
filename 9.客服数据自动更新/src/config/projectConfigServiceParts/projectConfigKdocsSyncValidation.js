// 该文件只把金山文档同步配置规范化成固定结构。
const { normalizeString } = require("./projectConfigValuePrimitives");

function validateKdocsDataDetailSyncConfig(kdocsDataDetailSync) {
  const syncSettings = kdocsDataDetailSync?.sync || {};
  const filterSettings = kdocsDataDetailSync?.filter || {};
  const customerServiceNameSettings = kdocsDataDetailSync?.customerServiceName || {};
  return {
    documentUrl: normalizeString(kdocsDataDetailSync?.documentUrl),
    syncWebhookUrl: normalizeString(
      kdocsDataDetailSync?.syncWebhookUrl ||
      kdocsDataDetailSync?.webhookUrl ||
      syncSettings.webhookUrl
    ),
    syncApiToken: normalizeString(
      kdocsDataDetailSync?.syncApiToken ||
      kdocsDataDetailSync?.apiToken ||
      syncSettings.apiToken
    ),
    filterWebhookUrl: normalizeString(
      kdocsDataDetailSync?.filterWebhookUrl ||
      filterSettings.webhookUrl
    ),
    filterApiToken: normalizeString(
      kdocsDataDetailSync?.filterApiToken ||
      filterSettings.apiToken
    ),
    customerServiceNameWebhookUrl: normalizeString(
      kdocsDataDetailSync?.customerServiceNameWebhookUrl ||
      customerServiceNameSettings.webhookUrl
    ),
    customerServiceNameApiToken: normalizeString(
      kdocsDataDetailSync?.customerServiceNameApiToken ||
      customerServiceNameSettings.apiToken
    )
  };
}

module.exports = { validateKdocsDataDetailSyncConfig };
