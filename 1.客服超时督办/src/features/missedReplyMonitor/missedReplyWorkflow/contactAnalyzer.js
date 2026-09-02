// 该文件用于读取单个会话消息，并交给统一未回复策略做判定。
const { fetchTransferMessages } = require('../../transferMonitor/transferApiClient');
const { resolveCurrentAssignment } = require('../../shared/currentAssignment');
const { analyzeUnresolvedReplyState, buildUnresolvedReplyReminderDecision } = require('../missedReplyPolicy');
const { MISSED_REPLY_LOG_MODULE_NAME } = require('./constants');

async function analyzeContactMissedReply(page, contact, replyConfig, memberMapByUserId = {}) {
  // 这里读取单个会话消息并交给统一未回复策略裁决，工作流不直接写判断细节。
  const messages = await fetchTransferMessages(page, contact.chatId, {
    logModuleName: MISSED_REPLY_LOG_MODULE_NAME,
    logMessageFetch: false
  });
  const assignment = resolveCurrentAssignment(contact, memberMapByUserId);
  const unresolvedState = {
    ...analyzeUnresolvedReplyState(contact, messages, replyConfig),
    assignmentStatus: assignment.status,
    assignmentStatusLabel: assignment.statusLabel
  };
  const reminderDecision = buildUnresolvedReplyReminderDecision(
    unresolvedState,
    replyConfig.timeoutReminderThresholdSeconds
  );

  return {
    unresolvedState,
    reminderDecision
  };
}

module.exports = {
  analyzeContactMissedReply
};
