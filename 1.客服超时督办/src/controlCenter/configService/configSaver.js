const appConfig = require("../../config/appConfig");
const { normalizeTargetUrl, writeAppRuntimeConfig } = require("../../config/appRuntimeConfig");
const { normalizeTimeText } = require("../../features/offDutyClose/offDutyConfig");
const { log } = require("../../engine/logger");
const { readControlCenterConfig } = require("./configReader");
const { readUtf8Text, writeUtf8Text } = require("./fileStore");
const { parsePositiveInteger } = require("./literalParsers");
const { parseKeywordRulesInput, serializeKeywordRuleListLiteral } = require("./keywordRuleText");
const {
  setReplyConfigSerializedValue,
  setReplyConfigValue
} = require("./replyConfigValue");

const replyConfigPath = appConfig.replyConfigPath;
const appRuntimeConfigPath = appConfig.appRuntimeConfigPath;

function saveControlCenterConfig(payload) {
  // 这里统一验证并保存主管端高频参数，避免网页层各自散落校验逻辑。
  const nextConfig = {
    targetUrl: normalizeTargetUrl(payload.targetUrl),
    timeoutReminderThresholdSeconds: parsePositiveInteger(
      payload.timeoutReminderThresholdSeconds,
      "提醒阈值(秒)"
    ),
    missedReplyMonitorEnabled: Boolean(payload.missedReplyMonitorEnabled),
    onlinePresenceMonitorEnabled: Boolean(payload.onlinePresenceMonitorEnabled),
    onlinePresenceScanIntervalMs: parsePositiveInteger(payload.onlinePresenceScanIntervalMs, "上班监控扫描间隔"),
    onlinePresenceWorkStartTime: normalizeTimeText(
      payload.onlinePresenceWorkStartTime,
      "08:00"
    ),
    transferAutoOpenEnabled: Boolean(payload.transferAutoOpenEnabled),
    transferAutoCloseEnabled: Boolean(payload.transferAutoCloseEnabled),
    missedReplyScanIntervalMs: parsePositiveInteger(payload.missedReplyScanIntervalMs, "漏回复轮询间隔"),
    missedReplyMaxContactsPerScan: parsePositiveInteger(
      payload.missedReplyMaxContactsPerScan,
      "漏回复每轮扫描会话数"
    ),
    missedReplyTemporaryReplyKeywords: parseKeywordRulesInput(
      payload.missedReplyTemporaryReplyKeywords,
      "稍等类临时回复关键词",
      "temporary"
    ),
    missedReplyCustomerResolutionKeywords: parseKeywordRulesInput(
      payload.missedReplyCustomerResolutionKeywords,
      "客户主动结案关键词",
      "resolution"
    ),
    missedReplyCustomerClosingKeywords: parseKeywordRulesInput(
      payload.missedReplyCustomerClosingKeywords,
      "客户弱收尾关键词",
      "closing"
    ),
    missedReplyInvalidAgentReplyKeywords: parseKeywordRulesInput(
      payload.missedReplyInvalidAgentReplyKeywords,
      "无效人工回复关键词",
      "invalid"
    ),
    missedReplyPlatformNoticeKeywords: parseKeywordRulesInput(
      payload.missedReplyPlatformNoticeKeywords,
      "平台提示过滤关键词",
      "platformNotice"
    ),
    groupChatFilterEnabled: Boolean(payload.groupChatFilterEnabled),
    offDutyAutomationEnabled: Boolean(payload.offDutyAutomationEnabled),
    offDutyScanIntervalMs: parsePositiveInteger(payload.offDutyScanIntervalMs, "下班检查间隔"),
    offDutyPreSalesEarlyStartTime: normalizeTimeText(
      payload.offDutyPreSalesEarlyStartTime,
      "08:00"
    ),
    offDutyPreSalesLateStartTime: normalizeTimeText(
      payload.offDutyPreSalesLateStartTime,
      "15:45"
    ),
    offDutyAfterSalesEarlyStartTime: normalizeTimeText(
      payload.offDutyAfterSalesEarlyStartTime,
      "08:00"
    ),
    offDutyAfterSalesLateStartTime: normalizeTimeText(
      payload.offDutyAfterSalesLateStartTime,
      "14:00"
    ),
    offDutyPreSalesEarlyCloseTime: normalizeTimeText(
      payload.offDutyPreSalesEarlyCloseTime,
      "16:30"
    ),
    offDutyPreSalesLateCloseTime: normalizeTimeText(
      payload.offDutyPreSalesLateCloseTime,
      "23:45"
    ),
    offDutyAfterSalesEarlyCloseTime: normalizeTimeText(
      payload.offDutyAfterSalesEarlyCloseTime,
      "16:30"
    ),
    offDutyAfterSalesLateCloseTime: normalizeTimeText(
      payload.offDutyAfterSalesLateCloseTime,
      "22:30"
    ),
    offDutyTomorrowShiftNotificationEnabled: Boolean(payload.offDutyTomorrowShiftNotificationEnabled)
  };

  let content = readUtf8Text(replyConfigPath);
  content = setReplyConfigValue(
    content,
    "timeoutReminderThresholdSeconds",
    nextConfig.timeoutReminderThresholdSeconds
  );
  content = setReplyConfigSerializedValue(
    content,
    "missedReplyMonitorEnabled",
    JSON.stringify(nextConfig.missedReplyMonitorEnabled)
  );
  content = setReplyConfigSerializedValue(
    content,
    "onlinePresenceMonitorEnabled",
    JSON.stringify(nextConfig.onlinePresenceMonitorEnabled)
  );
  content = setReplyConfigSerializedValue(
    content,
    "onlinePresenceScanIntervalMs",
    nextConfig.onlinePresenceScanIntervalMs
  );
  content = setReplyConfigSerializedValue(
    content,
    "onlinePresenceWorkStartTime",
    JSON.stringify(nextConfig.onlinePresenceWorkStartTime)
  );
  content = setReplyConfigSerializedValue(
    content,
    "transferAutoOpenEnabled",
    JSON.stringify(nextConfig.transferAutoOpenEnabled)
  );
  content = setReplyConfigSerializedValue(
    content,
    "transferAutoCloseEnabled",
    JSON.stringify(nextConfig.transferAutoCloseEnabled)
  );
  content = setReplyConfigSerializedValue(
    content,
    "missedReplyScanIntervalMs",
    nextConfig.missedReplyScanIntervalMs
  );
  content = setReplyConfigSerializedValue(
    content,
    "missedReplyMaxContactsPerScan",
    nextConfig.missedReplyMaxContactsPerScan
  );
  content = setReplyConfigSerializedValue(
    content,
    "missedReplyTemporaryReplyKeywords",
    serializeKeywordRuleListLiteral(nextConfig.missedReplyTemporaryReplyKeywords, "temporary")
  );
  content = setReplyConfigSerializedValue(
    content,
    "missedReplyCustomerResolutionKeywords",
    serializeKeywordRuleListLiteral(nextConfig.missedReplyCustomerResolutionKeywords, "resolution")
  );
  content = setReplyConfigSerializedValue(
    content,
    "missedReplyCustomerClosingKeywords",
    serializeKeywordRuleListLiteral(nextConfig.missedReplyCustomerClosingKeywords, "closing")
  );
  content = setReplyConfigSerializedValue(
    content,
    "missedReplyInvalidAgentReplyKeywords",
    serializeKeywordRuleListLiteral(nextConfig.missedReplyInvalidAgentReplyKeywords, "invalid")
  );
  content = setReplyConfigSerializedValue(
    content,
    "missedReplyPlatformNoticeKeywords",
    serializeKeywordRuleListLiteral(nextConfig.missedReplyPlatformNoticeKeywords, "platformNotice")
  );
  content = setReplyConfigSerializedValue(
    content,
    "groupChatFilterEnabled",
    JSON.stringify(nextConfig.groupChatFilterEnabled)
  );
  content = setReplyConfigValue(
    content,
    "offDutyAutomationEnabled",
    JSON.stringify(nextConfig.offDutyAutomationEnabled)
  );
  content = setReplyConfigValue(content, "offDutyScanIntervalMs", nextConfig.offDutyScanIntervalMs);
  content = setReplyConfigValue(
    content,
    "offDutyPreSalesEarlyStartTime",
    JSON.stringify(nextConfig.offDutyPreSalesEarlyStartTime)
  );
  content = setReplyConfigValue(
    content,
    "offDutyPreSalesLateStartTime",
    JSON.stringify(nextConfig.offDutyPreSalesLateStartTime)
  );
  content = setReplyConfigValue(
    content,
    "offDutyAfterSalesEarlyStartTime",
    JSON.stringify(nextConfig.offDutyAfterSalesEarlyStartTime)
  );
  content = setReplyConfigValue(
    content,
    "offDutyAfterSalesLateStartTime",
    JSON.stringify(nextConfig.offDutyAfterSalesLateStartTime)
  );
  content = setReplyConfigValue(
    content,
    "offDutyPreSalesEarlyCloseTime",
    JSON.stringify(nextConfig.offDutyPreSalesEarlyCloseTime)
  );
  content = setReplyConfigValue(
    content,
    "offDutyPreSalesLateCloseTime",
    JSON.stringify(nextConfig.offDutyPreSalesLateCloseTime)
  );
  content = setReplyConfigValue(
    content,
    "offDutyAfterSalesEarlyCloseTime",
    JSON.stringify(nextConfig.offDutyAfterSalesEarlyCloseTime)
  );
  content = setReplyConfigValue(
    content,
    "offDutyAfterSalesLateCloseTime",
    JSON.stringify(nextConfig.offDutyAfterSalesLateCloseTime)
  );
  content = setReplyConfigValue(
    content,
    "offDutyTomorrowShiftNotificationEnabled",
    JSON.stringify(nextConfig.offDutyTomorrowShiftNotificationEnabled)
  );

  writeUtf8Text(replyConfigPath, content);
  const runtimeConfig = writeAppRuntimeConfig(appRuntimeConfigPath, {
    targetUrl: nextConfig.targetUrl
  });
  appConfig.targetUrl = runtimeConfig.targetUrl;
  log("主线:完成", "网页控制台", "保存配置", "主管端生产配置写入完成");
  return readControlCenterConfig();
}

module.exports = {
  saveControlCenterConfig
};
