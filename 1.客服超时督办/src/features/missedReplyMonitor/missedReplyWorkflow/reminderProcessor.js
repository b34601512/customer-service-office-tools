// 该文件用于处理已到点的未实质回复提醒候选，保证同一事件不重复刷群。
const { log } = require('../../../engine/logger');
const { resolveCurrentAssignment } = require('../../shared/currentAssignment');
const { sendUnresolvedReplyReminder } = require('../missedReplyNotifier');
const {
  markUnresolvedReplyReminderSent,
  setUnresolvedReplyReminderSnapshot,
  shouldSendUnresolvedReplyReminder
} = require('../missedReplyStateStore');
const { resolveReminderKindLabel } = require('./decisionPresenter');
const { buildReminderSnapshot, recordUnresolvedReplyProcess } = require('./reminderRecord');
const { persistMissedReplyRuntimeState } = require('./runtimeState');
const { MISSED_REPLY_LOG_MODULE_NAME } = require('./constants');
const { recordTimeoutNotification } = require('../../timeoutPerformance/timeoutPerformanceLedger');

function formatAssignmentForLog(assignment) {
  // 日志明确写平台当前分配状态，不再把“未分配”误写成“未识别”。
  return String(assignment?.assigneeMember?.staffName || assignment?.statusLabel || "").trim();
}

async function processReminderCandidate(runtimeState, candidate, memberMapByUserId) {
  // 这里只处理已经达到阈值且这段提醒没发过的候选，同一事件不会循环刷群。
  if (!shouldSendUnresolvedReplyReminder(runtimeState, candidate)) {
    return false;
  }

  const assignment = resolveCurrentAssignment(candidate, memberMapByUserId);
  const assigneeMember = assignment.assigneeMember;
  const reminderResult = await sendUnresolvedReplyReminder({
    ...candidate,
    assignmentStatus: assignment.status,
    assigneeMember
  });
  const reminderSentAtMs = Date.now();
  if (candidate.reminderKind === "timeout") {
    recordTimeoutNotification({
      chatId: candidate.chatId,
      customerName: candidate.customerName,
      assignmentStatus: assignment.status,
      assigneeUserId: assignment.assignedToUserId,
      assigneeName: assigneeMember?.staffName,
      assigneeRoleLabel: assigneeMember?.roleLabel,
      assigneeStaffGroup: assigneeMember?.staffGroup,
      pendingSinceAtMs: candidate.pendingSinceAtMs,
      lastCustomerMessageAtMs: candidate.lastCustomerMessageAtMs,
      thresholdAtMs: candidate.timeoutReminderTargetAtMs,
      thresholdSeconds: candidate.timeoutThresholdSeconds,
      webhookName: reminderResult.webhookName
    }, reminderSentAtMs);
  }
  markUnresolvedReplyReminderSent(runtimeState, candidate, reminderSentAtMs);
  setUnresolvedReplyReminderSnapshot(
    runtimeState,
    buildReminderSnapshot(candidate, assignment, reminderResult, reminderSentAtMs)
  );
  persistMissedReplyRuntimeState(runtimeState);
  recordUnresolvedReplyProcess(candidate, assignment, reminderResult);
  log(
    "主线:完成",
    MISSED_REPLY_LOG_MODULE_NAME,
    "发送提醒",
    `类型=${resolveReminderKindLabel(candidate.reminderKind)}，客户=${candidate.customerName}，原因=${candidate.reasonLabel}，当前分配=${formatAssignmentForLog(assignment)}`
  );
  return true;
}

module.exports = {
  processReminderCandidate
};
