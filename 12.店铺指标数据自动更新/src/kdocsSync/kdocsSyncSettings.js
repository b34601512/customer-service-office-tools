const supportedKdocsHosts = new Set(["kdocs.cn", "www.kdocs.cn"]);

function parseKdocsHttpsUrl(rawUrl, fieldLabel) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error(`${fieldLabel}格式不正确。`);
  }
  if (parsedUrl.protocol !== "https:" || !supportedKdocsHosts.has(parsedUrl.hostname.toLowerCase())) {
    throw new Error(`${fieldLabel}必须是 https://www.kdocs.cn 开头的金山文档地址。`);
  }
  return parsedUrl;
}

function requireValidKdocsDocumentUrl(documentUrl) {
  const parsedUrl = parseKdocsHttpsUrl(documentUrl, "在线文档地址");
  if (!/^\/l\/[^/]+\/?$/i.test(parsedUrl.pathname)) {
    throw new Error("在线文档地址应是金山文档的分享地址，例如 https://www.kdocs.cn/l/xxxx。 ");
  }
  return parsedUrl.toString();
}

function requireValidKdocsWebhookUrl(webhookUrl) {
  const parsedUrl = parseKdocsHttpsUrl(webhookUrl, "AirScript webhook");
  const synchronousWebhookPattern = /^\/api\/v3\/ide\/file\/[^/]+\/script\/[^/]+\/sync_task\/?$/i;
  if (!synchronousWebhookPattern.test(parsedUrl.pathname)) {
    throw new Error("请粘贴文档共享脚本的同步 webhook，地址结尾应为 /sync_task。 ");
  }
  return parsedUrl.toString();
}

function requireCompleteKdocsSyncSettings(kdocsDataSourceSync) {
  const apiToken = String(kdocsDataSourceSync?.apiToken || "").trim();
  if (!apiToken) {
    throw new Error("尚未填写 AirScript 脚本令牌，请先进入金山文档同步的设置。 ");
  }
  return {
    documentUrl: requireValidKdocsDocumentUrl(kdocsDataSourceSync?.documentUrl),
    webhookUrl: requireValidKdocsWebhookUrl(kdocsDataSourceSync?.webhookUrl),
    apiToken
  };
}

function isKdocsSyncConfigured(kdocsDataSourceSync) {
  try {
    requireCompleteKdocsSyncSettings(kdocsDataSourceSync);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  requireValidKdocsDocumentUrl,
  requireValidKdocsWebhookUrl,
  requireCompleteKdocsSyncSettings,
  isKdocsSyncConfigured
};
