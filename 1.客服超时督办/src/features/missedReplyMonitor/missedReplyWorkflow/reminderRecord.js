// 该文件用于把未实质回复提醒写入过程看板和提醒复盘快照。
const { appendSupervisorProcessRecord } = require('../../supervision/supervisionReport');
const { MANAGER_STAFF_NAME } = require('../missedReplyNotifier');
const { formatMessageTime } = require('./timeFormatter');
const {
  MISSED_REPLY_MONITOR_MODE_NAME,
  MISSED_REPLY_MONITOR_PROMPT_TRACE
} = require('./constants');
const { resolveReminderKindLabel } = require('./decisionPresenter');

function resolveReminderRecordMeta(reminderKind) {
  // 这里统一定义两类提醒落入过程看板时的身份，避免工作流里到处拼文案。
  if (reminderKind === "timeout") {
    return {
      statusLabel: "已发送首次超时提醒",
      escalationStatus: "已发送首次超时提醒",
      dispatchAction: "first_timeout_unresolved_reply_reminder",
      reminderLabel: "首次超时"
    };
  }

  return {
    statusLabel: "已发送漏回复提醒",
    escalationStatus: "已发送漏回复提醒",
    dispatchAction: "missed_reply_monitor_reminder",
    reminderLabel: "10倍阈值漏回复"
  };
}

function resolveReminderDispatchTarget(assignment) {
  // 过程记录展示本次真实路由目标；未分配状态本身不是一名虚构客服。
  const staffName = String(assignment?.assigneeMember?.staffName || "").trim();
  const assignmentTarget = staffName || String(assignment?.statusLabel || "").trim();
  const dispatchTargets = [assignmentTarget].filter(Boolean);
  if (!dispatchTargets.includes(MANAGER_STAFF_NAME)) {
    dispatchTargets.push(MANAGER_STAFF_NAME);
  }

  return dispatchTargets.join(" + ");
}

function recordUnresolvedReplyProcess(candidate, assignment, reminderResult) {
  // 这里把统一未回复提醒写入过程看板，方便后续核对判断依据和提醒目标。
  const meta = resolveReminderRecordMeta(candidate.reminderKind);
  const assigneeMember = assignment.assigneeMember;
  appendSupervisorProcessRecord({
    occurredAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    customerName: candidate.customerName,
    statusLabel: meta.statusLabel,
    modeName: MISSED_REPLY_MONITOR_MODE_NAME,
    promptTrace: MISSED_REPLY_MONITOR_PROMPT_TRACE,
    queueRawText: "",
    queuePreviewText: "",
    queueTimeText: formatMessageTime(candidate.lastCustomerMessageAtMs),
    waitMarkerText: candidate.reasonLabel,
    lastCustomerMessage: candidate.lastCustomerMessageText,
    recentAgentReply: candidate.recentAgentReplyText,
    customerContext: `${meta.reminderLabel}｜${assignment.statusLabel}`,
    reason: `${resolveReminderKindLabel(candidate.reminderKind)}${candidate.pendingDurationSeconds}秒，原因=${candidate.reasonLabel}`,
    pendingDurationSeconds: candidate.pendingDurationSeconds,
    assignedToUserId: assignment.assignedToUserId,
    assignmentStatus: assignment.status,
    assignmentStatusLabel: assignment.statusLabel,
    assigneeName: assigneeMember?.staffName || "",
    assigneeRoleLabel: assigneeMember?.roleLabel || "",
    escalationStatus: meta.escalationStatus,
    escalationWebhookName: reminderResult.webhookName,
    dispatchAction: meta.dispatchAction,
    dispatchTarget: resolveReminderDispatchTarget(assignment),
    dispatchRawText: `chatId=${candidate.chatId}`,
    messages: candidate.messages
  });
}

function buildReminderSnapshot(candidate, assignment, reminderResult, reminderSentAtMs) {
  // 这里把发提醒时的同源判定事实压成页面可复盘快照。
  const assigneeMember = assignment.assigneeMember;
  return {
    chatId: candidate.chatId,
    customerName: candidate.customerName,
    reminderKind: candidate.reminderKind,
    reminderSentAtMs,
    reasonLabel: candidate.reasonLabel,
    pendingDurationSeconds: candidate.pendingDurationSeconds,
    assignedToUserId: assignment.assignedToUserId,
    assignmentStatus: assignment.status,
    assignmentStatusLabel: assignment.statusLabel,
    assigneeName: assigneeMember?.staffName || "",
    assigneeRoleLabel: assigneeMember?.roleLabel || "",
    lastCustomerMessageAtMs: candidate.lastCustomerMessageAtMs,
    lastCustomerMessageText: candidate.lastCustomerMessageText,
    recentAgentReplyText: candidate.recentAgentReplyText,
    latestMessageRole: candidate.latestMessageRole,
    latestMessageSenderName: candidate.latestMessageSenderName,
    latestMessageText: candidate.latestMessageText,
    latestMessageAtMs: candidate.latestMessageAtMs,
    dispatchTarget: resolveReminderDispatchTarget(assignment),
    webhookName: reminderResult.webhookName
  };
}

module.exports = {
  buildReminderSnapshot,
  recordUnresolvedReplyProcess,
  resolveReminderRecordMeta
};
