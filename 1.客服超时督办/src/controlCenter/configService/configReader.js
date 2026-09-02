const appConfig = require("../../config/appConfig");
const { loadReplyConfig } = require("../../config/replyConfigLoader");
const { buildOffDutyConfig } = require("../../features/offDutyClose/offDutyConfig");
const { readUtf8Text } = require("./fileStore");
const { getReplyConfigValueWithFallback } = require("./replyConfigValue");
const { parseBooleanLiteral, parseQuotedStringLiteral } = require("./literalParsers");

const replyConfigPath = appConfig.replyConfigPath;

function readControlCenterConfig() {
  // 这里统一收口主管端首页需要展示的配置和资源状态，前端只做渲染不再自行拼逻辑。
  const replyConfigContent = readUtf8Text(replyConfigPath);
  const replyRuntimeConfig = loadReplyConfig();
  const reminderThresholdSeconds = Number(
    getReplyConfigValueWithFallback(
      replyConfigContent,
      ["timeoutReminderThresholdSeconds"],
      "300"
    )
  );
  const offDutyConfig = buildOffDutyConfig({
    offDutyAutomationEnabled: parseBooleanLiteral(
      getReplyConfigValueWithFallback(replyConfigContent, ["offDutyAutomationEnabled"], "true"),
      true
    ),
    offDutyScanIntervalMs: Number(
      getReplyConfigValueWithFallback(replyConfigContent, ["offDutyScanIntervalMs"], "300000")
    ),
    offDutyPreSalesEarlyStartTime: parseQuotedStringLiteral(
      getReplyConfigValueWithFallback(replyConfigContent, ["offDutyPreSalesEarlyStartTime"], "\"08:00\""),
      "售前早班上班时间",
      "08:00"
    ),
    offDutyPreSalesLateStartTime: parseQuotedStringLiteral(
      getReplyConfigValueWithFallback(replyConfigContent, ["offDutyPreSalesLateStartTime"], "\"15:45\""),
      "售前晚班上班时间",
      "15:45"
    ),
    offDutyAfterSalesEarlyStartTime: parseQuotedStringLiteral(
      getReplyConfigValueWithFallback(replyConfigContent, ["offDutyAfterSalesEarlyStartTime"], "\"08:00\""),
      "售后早班上班时间",
      "08:00"
    ),
    offDutyAfterSalesLateStartTime: parseQuotedStringLiteral(
      getReplyConfigValueWithFallback(replyConfigContent, ["offDutyAfterSalesLateStartTime"], "\"14:00\""),
      "售后晚班上班时间",
      "14:00"
    ),
    offDutyPreSalesEarlyCloseTime: parseQuotedStringLiteral(
      getReplyConfigValueWithFallback(replyConfigContent, ["offDutyPreSalesEarlyCloseTime"], "\"16:30\""),
      "售前早班关闭时间",
      "16:30"
    ),
    offDutyPreSalesLateCloseTime: parseQuotedStringLiteral(
      getReplyConfigValueWithFallback(replyConfigContent, ["offDutyPreSalesLateCloseTime"], "\"23:45\""),
      "售前晚班关闭时间",
      "23:45"
    ),
    offDutyAfterSalesEarlyCloseTime: parseQuotedStringLiteral(
      getReplyConfigValueWithFallback(replyConfigContent, ["offDutyAfterSalesEarlyCloseTime"], "\"16:30\""),
      "售后早班关闭时间",
      "16:30"
    ),
    offDutyAfterSalesLateCloseTime: parseQuotedStringLiteral(
      getReplyConfigValueWithFallback(replyConfigContent, ["offDutyAfterSalesLateCloseTime"], "\"22:30\""),
      "售后晚班关闭时间",
      "22:30"
    ),
    offDutyTomorrowShiftNotificationEnabled: parseBooleanLiteral(
      getReplyConfigValueWithFallback(
        replyConfigContent,
        ["offDutyTomorrowShiftNotificationEnabled"],
        "false"
      ),
      false
    )
  });

  return {
    targetUrl: appConfig.targetUrl,
    modeName: offDutyConfig.offDutyAutomationEnabled
      ? "超时提醒 + 上班监控 + 下班监控"
      : "超时提醒 + 上班监控",
    timeoutReminderThresholdSeconds: reminderThresholdSeconds,
    missedReplyMonitorEnabled: replyRuntimeConfig.missedReplyMonitorEnabled,
    onlinePresenceMonitorEnabled: replyRuntimeConfig.onlinePresenceMonitorEnabled,
    onlinePresenceScanIntervalMs: replyRuntimeConfig.onlinePresenceScanIntervalMs,
    onlinePresenceWorkStartTime: replyRuntimeConfig.onlinePresenceWorkStartTime,
    transferAutoOpenEnabled: replyRuntimeConfig.transferAutoOpenEnabled,
    transferAutoCloseEnabled: replyRuntimeConfig.transferAutoCloseEnabled,
    missedReplyScanIntervalMs: replyRuntimeConfig.missedReplyScanIntervalMs,
    missedReplyMaxContactsPerScan: replyRuntimeConfig.missedReplyMaxContactsPerScan,
    missedReplyTemporaryReplyKeywords: replyRuntimeConfig.missedReplyTemporaryReplyKeywords,
    missedReplyCustomerResolutionKeywords: replyRuntimeConfig.missedReplyCustomerResolutionKeywords,
    missedReplyCustomerClosingKeywords: replyRuntimeConfig.missedReplyCustomerClosingKeywords,
    missedReplyInvalidAgentReplyKeywords: replyRuntimeConfig.missedReplyInvalidAgentReplyKeywords,
    missedReplyPlatformNoticeKeywords: replyRuntimeConfig.missedReplyPlatformNoticeKeywords,
    groupChatFilterEnabled: replyRuntimeConfig.groupChatFilterEnabled,
    ...offDutyConfig
  };
}

module.exports = {
  readControlCenterConfig
};
