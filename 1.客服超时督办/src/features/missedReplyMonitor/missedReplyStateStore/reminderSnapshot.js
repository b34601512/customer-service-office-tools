// 该文件用于维护提醒发出时的复盘快照。
const { normalizeObjectMap } = require("./stateShape");
const { normalizeReminderKind } = require("./reminderKind");
const {
  ASSIGNMENT_STATUS,
  normalizeAssignmentStatus,
  resolveAssignmentStatusLabel
} = require("../../shared/currentAssignment");

function normalizeReminderSnapshot(snapshot) {
  // 这里保存提醒发出那一刻的同源判定快照，页面复盘只读它，不重新判断。
  const assignedToUserId = String(snapshot?.assignedToUserId || "").trim();
  const rawAssigneeName = String(snapshot?.assigneeName || "").trim();
  const recordedAssignmentStatus = String(snapshot?.assignmentStatus || "").trim();
  const assignmentStatus = recordedAssignmentStatus
    ? normalizeAssignmentStatus(recordedAssignmentStatus, { assignedToUserId, assigneeName: rawAssigneeName })
    : "";
  const assignmentStatusLabel = recordedAssignmentStatus
    ? String(snapshot?.assignmentStatusLabel || "").trim() || resolveAssignmentStatusLabel(assignmentStatus)
    : "旧快照未保存分配依据";
  return {
    chatId: String(snapshot?.chatId || "").trim(),
    customerName: String(snapshot?.customerName || "").trim(),
    reminderKind: normalizeReminderKind(snapshot?.reminderKind),
    reminderSentAtMs: Number(snapshot?.reminderSentAtMs || snapshot?.lastReminderAtMs || 0),
    reasonLabel: String(snapshot?.reasonLabel || "").trim(),
    pendingDurationSeconds: Number(snapshot?.pendingDurationSeconds || 0),
    assignedToUserId,
    assignmentStatus,
    assignmentStatusLabel,
    assigneeName: assignmentStatus === ASSIGNMENT_STATUS.ASSIGNED || assignmentStatus === ASSIGNMENT_STATUS.LAST_HANDLER ? rawAssigneeName : "",
    assigneeRoleLabel: String(snapshot?.assigneeRoleLabel || "").trim(),
    lastCustomerMessageAtMs: Number(snapshot?.lastCustomerMessageAtMs || 0),
    lastCustomerMessageText: String(snapshot?.lastCustomerMessageText || ""),
    recentAgentReplyText: String(snapshot?.recentAgentReplyText || ""),
    latestMessageRole: String(snapshot?.latestMessageRole || ""),
    latestMessageSenderName: String(snapshot?.latestMessageSenderName || ""),
    latestMessageText: String(snapshot?.latestMessageText || ""),
    latestMessageAtMs: Number(snapshot?.latestMessageAtMs || 0),
    dispatchTarget: String(snapshot?.dispatchTarget || ""),
    webhookName: String(snapshot?.webhookName || "")
  };
}

function normalizeReminderSnapshotsByChatId(snapshotsByChatId) {
  // 这里统一清洗提醒复盘快照，避免坏历史记录污染倒计时明细。
  return Object.fromEntries(
    Object.entries(normalizeObjectMap(snapshotsByChatId))
      .map(([chatId, snapshot]) => [String(chatId || "").trim(), normalizeReminderSnapshot({
        ...snapshot,
        chatId: snapshot?.chatId || chatId
      })])
      .filter(([, snapshot]) => snapshot.chatId && snapshot.reminderSentAtMs > 0)
  );
}

function setUnresolvedReplyReminderSnapshot(runtimeState, snapshot) {
  // 这里记录提醒发出时的同源判定事实，让倒计时明细能解释历史提醒。
  const normalizedSnapshot = normalizeReminderSnapshot(snapshot);
  if (!normalizedSnapshot.chatId) {
    throw new Error("未实质回复提醒快照写入失败：chatId 为空。");
  }
  if (!normalizedSnapshot.reminderKind) {
    throw new Error("未实质回复提醒快照写入失败：提醒类型为空。");
  }
  if (normalizedSnapshot.reminderSentAtMs <= 0) {
    throw new Error("未实质回复提醒快照写入失败：提醒时间为空。");
  }
  if (!runtimeState.reminderSnapshotsByChatId || typeof runtimeState.reminderSnapshotsByChatId !== "object") {
    runtimeState.reminderSnapshotsByChatId = {};
  }

  runtimeState.reminderSnapshotsByChatId[normalizedSnapshot.chatId] = normalizedSnapshot;
  return true;
}

function clearUnresolvedReplyReminderSnapshot(runtimeState, chatId) {
  // 这里清理已经离开当前客户镜像的提醒快照，避免长期运行堆积无关历史。
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId || !runtimeState.reminderSnapshotsByChatId?.[normalizedChatId]) {
    return false;
  }

  delete runtimeState.reminderSnapshotsByChatId[normalizedChatId];
  return true;
}

module.exports = {
  normalizeReminderSnapshot,
  normalizeReminderSnapshotsByChatId,
  setUnresolvedReplyReminderSnapshot,
  clearUnresolvedReplyReminderSnapshot
};
