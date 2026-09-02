const appConfig = require("./appConfig");
const { buildOffDutyConfig, normalizeTimeText } = require("../features/offDutyClose/offDutyConfig");
const { KEYWORD_MATCH_MODES, normalizeKeywordRules } = require("../features/missedReplyMonitor/keywordRules");

const DEFAULT_TEMPORARY_REPLY_KEYWORDS = [
  { text: "稍等", matchMode: KEYWORD_MATCH_MODES.startsWith },
  { text: "请稍等", matchMode: KEYWORD_MATCH_MODES.startsWith },
  { text: "稍等一下", matchMode: KEYWORD_MATCH_MODES.startsWith },
  { text: "稍后回复", matchMode: KEYWORD_MATCH_MODES.startsWith },
  { text: "帮您看下", matchMode: KEYWORD_MATCH_MODES.startsWith },
  { text: "我看一下", matchMode: KEYWORD_MATCH_MODES.startsWith },
  { text: "我查一下", matchMode: KEYWORD_MATCH_MODES.startsWith },
  { text: "这边核实一下", matchMode: KEYWORD_MATCH_MODES.startsWith },
  { text: "这边确认一下", matchMode: KEYWORD_MATCH_MODES.startsWith },
  { text: "我帮您跟领导反馈一下看看吧", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "1", matchMode: KEYWORD_MATCH_MODES.exact }
];

const DEFAULT_CUSTOMER_RESOLUTION_KEYWORDS = [
  { text: "找到问题了", matchMode: KEYWORD_MATCH_MODES.includes }
];

const DEFAULT_CUSTOMER_CLOSING_KEYWORDS = [
  { text: "谢谢", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "好的", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "好", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "嗯", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "嗯嗯", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "嗯呢", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "表情", matchMode: KEYWORD_MATCH_MODES.exact }
];

const DEFAULT_INVALID_AGENT_REPLY_KEYWORDS = [
  { text: ".", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "。", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "，", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: ",", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "、", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "...", matchMode: KEYWORD_MATCH_MODES.exact },
  { text: "…", matchMode: KEYWORD_MATCH_MODES.exact }
];

const DEFAULT_PLATFORM_NOTICE_KEYWORDS = [
  { text: "我已经添加了你", matchMode: KEYWORD_MATCH_MODES.startsWith },
  { text: "我已添加了你", matchMode: KEYWORD_MATCH_MODES.startsWith },
  { text: "你已添加了", matchMode: KEYWORD_MATCH_MODES.startsWith }
];

const DEFAULT_UNREACHABLE_CONTACT_KEYWORDS = [
  { text: "你还不是他（她）的联系人", matchMode: KEYWORD_MATCH_MODES.includes },
  { text: "你还不是他(她)的联系人", matchMode: KEYWORD_MATCH_MODES.includes },
  { text: "请先发送联系人验证请求，对方验证通过后，才能聊天", matchMode: KEYWORD_MATCH_MODES.includes }
];

function normalizePositiveNumber(value, defaultValue) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : defaultValue;
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  return Boolean(value);
}

function resolveFirstDefinedValue(config, keyNames) {
  // 这里统一做兼容读取，避免生产环境切换新旧配置键名时直接炸掉。
  for (const keyName of keyNames) {
    if (config[keyName] !== undefined) {
      return config[keyName];
    }
  }

  return undefined;
}

function loadReplyConfig() {
  // 这里统一读取主管端督办配置，只保留当前生产链路还在使用的字段。
  try {
    delete require.cache[require.resolve(appConfig.replyConfigPath)];
    const config = require(appConfig.replyConfigPath);
    const reminderThresholdSeconds = normalizePositiveNumber(
      resolveFirstDefinedValue(config, ["timeoutReminderThresholdSeconds"]),
      300
    );
    return {
      transferMonitorScanIntervalMs: normalizePositiveNumber(config.transferMonitorScanIntervalMs, 1500),
      missedReplyMonitorEnabled: normalizeBoolean(config.missedReplyMonitorEnabled, true),
      onlinePresenceMonitorEnabled: normalizeBoolean(config.onlinePresenceMonitorEnabled, true),
      onlinePresenceScanIntervalMs: normalizePositiveNumber(config.onlinePresenceScanIntervalMs, 5000),
      onlinePresenceWorkStartTime: normalizeTimeText(config.onlinePresenceWorkStartTime, "08:00"),
      transferAutoOpenEnabled: normalizeBoolean(config.transferAutoOpenEnabled, true),
      transferAutoCloseEnabled: normalizeBoolean(config.transferAutoCloseEnabled, true),
      missedReplyScanIntervalMs: normalizePositiveNumber(config.missedReplyScanIntervalMs, 5000),
      missedReplyMaxContactsPerScan: normalizePositiveNumber(config.missedReplyMaxContactsPerScan, 20),
      missedReplyTemporaryReplyKeywords: normalizeKeywordRules(
        config.missedReplyTemporaryReplyKeywords,
        "temporary",
        DEFAULT_TEMPORARY_REPLY_KEYWORDS
      ),
      missedReplyCustomerResolutionKeywords: normalizeKeywordRules(
        config.missedReplyCustomerResolutionKeywords,
        "resolution",
        DEFAULT_CUSTOMER_RESOLUTION_KEYWORDS
      ),
      missedReplyCustomerClosingKeywords: normalizeKeywordRules(
        config.missedReplyCustomerClosingKeywords,
        "closing",
        DEFAULT_CUSTOMER_CLOSING_KEYWORDS
      ),
      missedReplyInvalidAgentReplyKeywords: normalizeKeywordRules(
        config.missedReplyInvalidAgentReplyKeywords,
        "invalid",
        DEFAULT_INVALID_AGENT_REPLY_KEYWORDS
      ),
      missedReplyPlatformNoticeKeywords: normalizeKeywordRules(
        config.missedReplyPlatformNoticeKeywords,
        "platformNotice",
        DEFAULT_PLATFORM_NOTICE_KEYWORDS
      ),
      missedReplyUnreachableContactKeywords: normalizeKeywordRules(
        config.missedReplyUnreachableContactKeywords,
        "platformNotice",
        DEFAULT_UNREACHABLE_CONTACT_KEYWORDS
      ),
      groupChatFilterEnabled: normalizeBoolean(config.groupChatFilterEnabled, true),
      timeoutReminderThresholdSeconds: reminderThresholdSeconds,
      ...buildOffDutyConfig(config)
    };
  } catch (error) {
    throw new Error(`督办策略配置文件加载失败：${error.message}`);
  }
}

module.exports = {
  loadReplyConfig
};
