// 该文件是漏回复策略的公共入口，具体判断能力拆到 missedReplyPolicy 目录。
const { MISSED_REPLY_THRESHOLD_MULTIPLIER } = require("./missedReplyPolicy/constants");
const { analyzeUnresolvedReplyState } = require("./missedReplyPolicy/analyzer");
const { buildLatestMessageFields } = require("./missedReplyPolicy/reportMessages");
const { buildUnresolvedReplyReminderDecision } = require("./missedReplyPolicy/reminderDecision");
const {
  findLatestCustomerMessage,
  isNeedToHandleCustomerMessage
} = require("./missedReplyPolicy/customerMessageFilter");
const { resolveMissedReplyThresholdSeconds } = require("./missedReplyPolicy/thresholds");
const { buildReplyObligation } = require("./missedReplyPolicy/replyObligation");

module.exports = {
  MISSED_REPLY_THRESHOLD_MULTIPLIER,
  analyzeUnresolvedReplyState,
  buildLatestMessageFields,
  buildReplyObligation,
  buildUnresolvedReplyReminderDecision,
  findLatestCustomerMessage,
  isNeedToHandleCustomerMessage,
  resolveMissedReplyThresholdSeconds
};
