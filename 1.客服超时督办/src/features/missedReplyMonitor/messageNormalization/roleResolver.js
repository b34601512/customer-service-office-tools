const { firstTextValue, resolveMessageText } = require("./contentParser");
const { matchesKeywordRules } = require("../replyClassifier");

function includesAny(value, keywords) {
  // 这里做短文本关键词匹配，只用于角色和发送人这类结构化字段。
  const text = String(value || "").toLowerCase();
  return keywords.some((keyword) => text.includes(String(keyword).toLowerCase()));
}

function hasTruthyFlag(message, content, flagNames) {
  // 这里兼容旧测试和可能存在的布尔角色字段。
  for (const flagName of flagNames) {
    if (message?.[flagName] === true || content?.[flagName] === true) {
      return true;
    }
  }

  return false;
}

function isConfiguredPlatformNoticeText(text, replyConfig) {
  // 这里只按配置过滤平台固定提示，避免把客户真实发言写死在代码里误删。
  return matchesKeywordRules(text, replyConfig?.missedReplyPlatformNoticeKeywords || [], "platformNotice");
}

function isSystemOperationMessage(message, content, text, replyConfig) {
  // 这里只过滤真正平台事件，避免把真实客户和人工消息丢掉。
  const contentType = Number(content?.type ?? message?.type);
  const roleText = firstTextValue([
    message?.role,
    message?.senderRole,
    message?.senderType,
    message?.fromType,
    content?.role,
    content?.senderType
  ]);

  return (
    contentType === 10000 ||
    contentType === 10001 ||
    includesAny(roleText, ["system", "sys", "notice", "event"]) ||
    text.includes("系统分配") ||
    text.includes("转接给") ||
    text.includes("转接至") ||
    text.includes("转接到") ||
    isConfiguredPlatformNoticeText(text, replyConfig)
  );
}

function isPlatformAutoReply(senderProfile) {
  // 这里按平台 sendBy.source 区分自动回复，source=1 才是人工。
  if (!senderProfile.hasPlatformFrom) {
    return false;
  }

  return (
    senderProfile.isSelf === true &&
    (
      senderProfile.sendBySource === 3 ||
      senderProfile.sendBySource === 9 ||
      includesAny(senderProfile.sendByName, ["自动回复", "机器人", "标签sop", "sop", "ai", "助手"])
    )
  );
}

function isAutoReplyMessage(message, content, senderProfile) {
  // 这里排除机器人和 AI 回复，避免自动话术清掉人工未回复状态。
  return (
    isPlatformAutoReply(senderProfile) ||
    hasTruthyFlag(message, content, ["isAutoReply", "autoReply", "isRobot", "robot", "isBot", "bot"]) ||
    includesAny(firstTextValue([message?.senderName, senderProfile.sendByName, senderProfile.displayName]), [
      "机器人",
      "自动回复",
      "ai",
      "助手"
    ]) ||
    includesAny(firstTextValue([message?.role, message?.senderRole, message?.senderType, content?.role]), [
      "bot",
      "robot",
      "ai"
    ])
  );
}

function resolvePlatformMessageRole(senderProfile) {
  // 这里用现场验证过的 from 字段作为生产环境第一判断依据。
  if (!senderProfile.hasPlatformFrom) {
    return "";
  }

  if (senderProfile.isSelf === false && senderProfile.isCoworker === false && senderProfile.contactType === 1) {
    return "customer";
  }

  // 自己（或同组织同事）发的消息都是内部人工回复：
  // 电脑端 sendBy.source=1；企微手机端 sendBy.source=0 且 sendBy.name="来自手机"，同样算人工。
  // 另外带公司归属（如 from.corporation="德达集团"）或 coworker=true 的发送者也是公司自己人，
  // 不是客户，避免运营/同事发言被当成客户消息触发漏回复提醒。
  if (
    senderProfile.isSelf === true ||
    senderProfile.isCoworker === true ||
    String(senderProfile.corporation || "").trim()
  ) {
    return "agent";
  }

  return "";
}

function resolveLegacyMessageRole(message, content, contact, senderProfile) {
  // 这里保留旧字段兼容，但不再把它当作生产现场主依据。
  if (hasTruthyFlag(message, content, ["isCustomer", "fromCustomer", "isFromCustomer"])) {
    return "customer";
  }

  if (hasTruthyFlag(message, content, ["isStaff", "isAgent", "fromStaff", "fromAgent", "isFromStaff", "isFromAgent"])) {
    return "agent";
  }

  if (hasTruthyFlag(message, content, ["isMe", "fromMe", "isFromMe", "sentByMe"])) {
    return "agent";
  }

  const roleText = firstTextValue([
    message?.role,
    message?.senderRole,
    message?.messageRole,
    message?.senderType,
    message?.fromType,
    message?.userType,
    content?.role,
    content?.senderRole,
    content?.senderType
  ]);
  if (includesAny(roleText, ["customer", "client", "guest", "visitor", "buyer", "external", "wechat", "wx"])) {
    return "customer";
  }

  if (includesAny(roleText, ["staff", "agent", "service", "kefu", "employee", "member", "internal", "operator", "seller"])) {
    return "agent";
  }

  const contactName = String(contact?.customerName || "").trim();
  if (contactName && senderProfile.displayName && senderProfile.displayName === contactName) {
    return "customer";
  }

  if (includesAny(firstTextValue([senderProfile.sendByName, senderProfile.displayName]), ["客服", "售前", "售后", "运营", "主管", "经理"])) {
    return "agent";
  }

  return "unknown";
}

function resolveMessageRole(message, content, contact, senderProfile, replyConfig = {}) {
  // 这里把平台消息压成 customer、agent、bot、system、unknown 五类。
  const text = resolveMessageText(message, content);
  if (isSystemOperationMessage(message, content, text, replyConfig)) {
    return "system";
  }

  if (isAutoReplyMessage(message, content, senderProfile)) {
    return "bot";
  }

  const platformRole = resolvePlatformMessageRole(senderProfile);
  if (platformRole) {
    return platformRole;
  }

  return resolveLegacyMessageRole(message, content, contact, senderProfile);
}

module.exports = {
  resolveMessageRole
};
