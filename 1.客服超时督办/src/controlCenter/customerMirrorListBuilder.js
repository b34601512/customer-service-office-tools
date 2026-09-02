const {
  ASSIGNMENT_STATUS,
  normalizeAssignmentStatus,
  resolveAssignmentStatusLabel
} = require("../features/shared/currentAssignment");

function normalizeCountdownSeconds(targetAtMs, nowMs) {
  // 这里统一计算剩余秒数，让前端只负责展示，不重复推断提醒时间。
  const numericTargetAtMs = Number(targetAtMs || 0);
  if (!Number.isFinite(numericTargetAtMs) || numericTargetAtMs <= 0) {
    return 0;
  }

  return Math.max(0, Math.ceil((numericTargetAtMs - nowMs) / 1000));
}

function buildStatusTag(label, type = "neutral") {
  // 这里用统一标签结构表达判断结果，页面不再自己理解业务规则。
  return {
    label,
    type
  };
}

function normalizeCustomerName(value) {
  // 这里统一清洗客户名，避免页面出现空白或重复空格。
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resolveMessageRoleLabel(role) {
  // 这里把判定引擎的消息角色翻译成现场能看懂的发送方。
  const normalizedRole = String(role || "").trim();
  if (normalizedRole === "customer") {
    return "客户";
  }
  if (normalizedRole === "agent") {
    return "客服";
  }
  if (normalizedRole === "bot") {
    return "自动回复";
  }

  return "未知";
}

function resolveReminderKindLabel(reminderKind) {
  // 这里把提醒类型翻译成页面短标签，避免前端再理解内部枚举。
  return String(reminderKind || "") === "timeout" ? "超时提醒" : "漏回复提醒";
}

function buildRecentReminderSnapshot(snapshot) {
  // 这里把提醒发生时的判定快照压成前端可直接展示的复盘对象。
  if (!snapshot || Number(snapshot.reminderSentAtMs || 0) <= 0) {
    return null;
  }

  const recordedAssignmentStatus = String(snapshot.assignmentStatus || "").trim();
  const assignmentStatus = recordedAssignmentStatus
    ? normalizeAssignmentStatus(recordedAssignmentStatus, snapshot)
    : "";
  return {
    reminderKind: String(snapshot.reminderKind || ""),
    reminderKindLabel: resolveReminderKindLabel(snapshot.reminderKind),
    reminderSentAtMs: Number(snapshot.reminderSentAtMs || 0),
    reasonLabel: String(snapshot.reasonLabel || ""),
    pendingDurationSeconds: Number(snapshot.pendingDurationSeconds || 0),
    assignedToUserId: String(snapshot.assignedToUserId || ""),
    assignmentStatus,
    assignmentStatusLabel: String(snapshot.assignmentStatusLabel || "") || (
      assignmentStatus ? resolveAssignmentStatusLabel(assignmentStatus) : "旧快照未保存分配依据"
    ),
    assigneeName: String(snapshot.assigneeName || ""),
    assigneeRoleLabel: String(snapshot.assigneeRoleLabel || ""),
    lastCustomerMessageAtMs: Number(snapshot.lastCustomerMessageAtMs || 0),
    lastCustomerMessageText: String(snapshot.lastCustomerMessageText || ""),
    recentAgentReplyText: String(snapshot.recentAgentReplyText || ""),
    latestMessageRole: String(snapshot.latestMessageRole || ""),
    latestMessageRoleLabel: resolveMessageRoleLabel(snapshot.latestMessageRole),
    latestMessageSenderName: String(snapshot.latestMessageSenderName || ""),
    latestMessageText: String(snapshot.latestMessageText || ""),
    latestMessageAtMs: Number(snapshot.latestMessageAtMs || 0),
    dispatchTarget: String(snapshot.dispatchTarget || ""),
    webhookName: String(snapshot.webhookName || "")
  };
}

function buildUnifiedReplyMirrorState(decisionItem, state, nowMs) {
  // 这里把统一未回复引擎的判定、倒计时和两段提醒状态合成同一个客户状态。
  const chatId = String(decisionItem.chatId || "");
  const countdown = state?.countdownItemsByChatId?.[chatId] || {};
  const reminderEvent = state?.reminderEventsByChatId?.[chatId] || null;
  const recentReminderSnapshot = buildRecentReminderSnapshot(state?.reminderSnapshotsByChatId?.[chatId]);
  const timeoutReminderTargetAtMs = Number(decisionItem.timeoutReminderTargetAtMs || 0);
  const missedReplyReminderTargetAtMs = Number(decisionItem.missedReplyReminderTargetAtMs || 0);
  const nextReminderAtMs = Number(decisionItem.nextReminderAtMs || countdown.nextReminderAtMs || 0);

  const assignmentStatus = normalizeAssignmentStatus(decisionItem.assignmentStatus, decisionItem);
  return {
    chatId,
    customerName: normalizeCustomerName(decisionItem.customerName),
    assignedToUserId: String(decisionItem.assignedToUserId || ""),
    assignmentStatus,
    assignmentStatusLabel: String(decisionItem.assignmentStatusLabel || "") || resolveAssignmentStatusLabel(assignmentStatus),
    contactListIndex: Number(decisionItem.contactListIndex || 0),
    previewText: String(decisionItem.previewText || ""),
    decisionReason: String(decisionItem.decisionReason || decisionItem.reasonLabel || "未说明原因"),
    reasonLabel: String(decisionItem.reasonLabel || ""),
    latestMessageRole: String(decisionItem.latestMessageRole || ""),
    latestMessageRoleLabel: resolveMessageRoleLabel(decisionItem.latestMessageRole),
    latestMessageSenderName: String(decisionItem.latestMessageSenderName || ""),
    latestMessageText: String(decisionItem.latestMessageText || ""),
    latestMessageAtMs: Number(decisionItem.latestMessageAtMs || 0),
    lastCustomerMessageText: String(decisionItem.lastCustomerMessageText || ""),
    recentAgentReplyText: String(decisionItem.recentAgentReplyText || ""),
    pendingDurationSeconds: Number(decisionItem.pendingDurationSeconds || 0),
    timeoutStatusLabel: String(decisionItem.timeoutStatusLabel || "未进入超时"),
    timeoutDecisionReason: String(decisionItem.timeoutDecisionReason || decisionItem.reasonLabel || ""),
    timeoutShouldRemind: Boolean(decisionItem.timeoutShouldRemind),
    isPendingTimeoutReplyCandidate: Boolean(decisionItem.isPendingTimeoutReplyCandidate),
    isTimeoutReminderSent: Boolean(reminderEvent?.timeoutReminderSentAtMs && decisionItem.isPendingTimeoutReplyCandidate),
    timeoutReminderTargetAtMs,
    timeoutReminderRemainingSeconds:
      String(decisionItem.nextReminderKind || countdown.nextReminderKind || "") === "timeout"
        ? normalizeCountdownSeconds(nextReminderAtMs, nowMs)
        : 0,
    missedReplyStatusLabel: String(decisionItem.missedReplyStatusLabel || decisionItem.statusLabel || "未进入漏回复"),
    missedReplyDecisionReason: String(decisionItem.missedReplyDecisionReason || decisionItem.decisionReason || decisionItem.reasonLabel || ""),
    missedReplyShouldRemind: Boolean(decisionItem.missedReplyShouldRemind),
    isPendingMissedReplyCandidate: Boolean(decisionItem.isPendingMissedReplyCandidate),
    isMissedReplyReminderSent: Boolean(reminderEvent?.missedReplyReminderSentAtMs),
    missedReplyReminderTargetAtMs,
    missedReplyReminderRemainingSeconds:
      String(decisionItem.nextReminderKind || countdown.nextReminderKind || "") === "missedReply"
        ? normalizeCountdownSeconds(nextReminderAtMs, nowMs)
        : 0,
    recentReminderSnapshot,
    scannedAtMs: Number(decisionItem.scannedAtMs || 0)
  };
}

function buildUnifiedReplyStates(missedReplyState, nowMs) {
  // 这里以统一未回复引擎的完整接口镜像为唯一客户列表来源。
  return Object.values(missedReplyState?.decisionItemsByChatId || {})
    .map((decisionItem) => buildUnifiedReplyMirrorState(decisionItem, missedReplyState, nowMs))
    .filter((item) => item.chatId && item.customerName);
}

function compareUnifiedReplyMirrorState(left, right) {
  // 这里优先按接口客户列表顺序展示；旧状态缺少顺序时才按扫描时间兜底。
  const leftIndex = Number(left.contactListIndex || 0);
  const rightIndex = Number(right.contactListIndex || 0);
  if (leftIndex > 0 && rightIndex > 0 && leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }
  if (leftIndex > 0 && rightIndex <= 0) {
    return -1;
  }
  if (leftIndex <= 0 && rightIndex > 0) {
    return 1;
  }

  return Number(right.scannedAtMs || 0) - Number(left.scannedAtMs || 0);
}

function resolveTimeoutTag(state) {
  // 这里只有统一引擎判定超时状态，不再读取平台待回复/超时/倒计时显示标记。
  if (!state) {
    return buildStatusTag("超时未扫描", "neutral");
  }
  if (state.isTimeoutReminderSent) {
    return buildStatusTag("超时已提醒", "success");
  }
  if (state.timeoutShouldRemind) {
    return buildStatusTag("超时已到点", "danger");
  }
  if (state.isPendingTimeoutReplyCandidate) {
    return buildStatusTag("超时未到点", "warning");
  }

  return buildStatusTag("未进入超时", "neutral");
}

function resolveMissedReplyTag(state) {
  // 这里用同一套未回复状态表达长阈值漏回复结果。
  if (!state) {
    return buildStatusTag("漏回复未扫描", "neutral");
  }
  if (state.isMissedReplyReminderSent) {
    return buildStatusTag("漏回复已提醒", "success");
  }
  if (state.missedReplyShouldRemind) {
    return buildStatusTag("漏回复已到点", "danger");
  }
  if (state.isPendingMissedReplyCandidate) {
    return buildStatusTag("漏回复未到点", "warning");
  }

  return buildStatusTag("未进入漏回复", "neutral");
}

function resolveRecentReminderTag(state) {
  // 这里只在当前状态无法体现已提醒时，补充最近一次提醒复盘状态。
  const snapshot = state?.recentReminderSnapshot;
  if (!snapshot || state.isTimeoutReminderSent || state.isMissedReplyReminderSent) {
    return null;
  }
  if (!state.isPendingTimeoutReplyCandidate && !state.isPendingMissedReplyCandidate) {
    return buildStatusTag("提醒后已恢复", "success");
  }

  return buildStatusTag(`最近${snapshot.reminderKindLabel}`, "success");
}

function resolveAssignmentTag(state) {
  // 分配状态由后端业务层给出，页面只决定标签颜色。
  if (state.assignmentStatus === ASSIGNMENT_STATUS.UNASSIGNED) {
    return buildStatusTag(state.assignmentStatusLabel, "danger");
  }
  if (state.assignmentStatus === ASSIGNMENT_STATUS.MEMBER_MAPPING_MISSING) {
    return buildStatusTag(state.assignmentStatusLabel, "warning");
  }

  return buildStatusTag(state.assignmentStatusLabel, "neutral");
}

function buildMirrorReasonText(state) {
  // 这里把统一引擎的判断依据压成短句，现场核对时一眼能看出依据。
  if (!state) {
    return "暂无判定依据";
  }

  return [
    state.timeoutDecisionReason ? `超时依据：${state.timeoutDecisionReason}` : "",
    state.missedReplyDecisionReason ? `漏回复依据：${state.missedReplyDecisionReason}` : ""
  ].filter(Boolean).join("｜") || "暂无判定依据";
}

function buildMirrorMessageText(state) {
  // 这里优先展示客户列表预览，其次展示统一引擎读取到的客户消息。
  if (state?.previewText) {
    return state.previewText;
  }
  if (state?.lastCustomerMessageText) {
    return state.lastCustomerMessageText;
  }

  return "";
}

function buildCustomerMirrorRow(state) {
  // 这里把统一判定结果压成前端唯一消费的客户行，不再混入旧队列快照。
  const recentReminderTag = resolveRecentReminderTag(state);
  return {
    key: state.chatId,
    chatId: state.chatId,
    customerName: state.customerName || "未识别客户",
    contactListIndex: Number(state.contactListIndex || 0),
    previewText: buildMirrorMessageText(state),
    reasonText: buildMirrorReasonText(state),
    statusTags: [
      resolveAssignmentTag(state),
      resolveTimeoutTag(state),
      resolveMissedReplyTag(state),
      recentReminderTag
    ].filter(Boolean),
    timeoutPendingDurationSeconds: Number(state.pendingDurationSeconds || 0),
    assignedToUserId: state.assignedToUserId || "",
    assignmentStatus: state.assignmentStatus || "",
    assignmentStatusLabel: state.assignmentStatusLabel || "",
    timeoutReminderTargetAtMs: Number(state.timeoutReminderTargetAtMs || 0),
    timeoutReminderRemainingSeconds: Number(state.timeoutReminderRemainingSeconds || 0),
    missedReplyStatusLabel: state.missedReplyStatusLabel || "",
    missedReplyDecisionReason: state.missedReplyDecisionReason || "",
    latestMessageRole: state.latestMessageRole || "",
    latestMessageRoleLabel: state.latestMessageRoleLabel || resolveMessageRoleLabel(state.latestMessageRole),
    latestMessageSenderName: state.latestMessageSenderName || "",
    latestMessageText: state.latestMessageText || "",
    latestMessageAtMs: Number(state.latestMessageAtMs || 0),
    lastCustomerMessageText: state.lastCustomerMessageText || "",
    recentAgentReplyText: state.recentAgentReplyText || "",
    recentReminderSnapshot: state.recentReminderSnapshot,
    missedReplyPendingDurationSeconds: Number(state.pendingDurationSeconds || 0),
    missedReplyReminderTargetAtMs: Number(state.missedReplyReminderTargetAtMs || 0),
    missedReplyReminderRemainingSeconds: Number(state.missedReplyReminderRemainingSeconds || 0),
    missedReplyScannedAtMs: Number(state.scannedAtMs || 0)
  };
}

function buildCustomerMirrorItems(missedReplyState, nowMs = Date.now()) {
  // 这里生成控制台唯一客户镜像列表：系统看到谁、同一套未回复引擎给了什么标签。
  return buildUnifiedReplyStates(missedReplyState, nowMs)
    .sort(compareUnifiedReplyMirrorState)
    .map(buildCustomerMirrorRow);
}

module.exports = {
  buildCustomerMirrorItems,
  normalizeCountdownSeconds
};
