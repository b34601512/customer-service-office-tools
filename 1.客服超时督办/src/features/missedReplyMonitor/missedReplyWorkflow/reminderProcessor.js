// 该文件用于处理已到点的未实质回复提醒候选，保证同一事件不重复刷群。
const { log, logError } = require('../../../engine/logger');
const { isLoginRequiredError } = require('../../loginFlow');
const {
  ASSIGNMENT_STATUS,
  resolveCurrentAssignment
} = require('../../shared/currentAssignment');
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
const { resolveTargetRouteMeta } = require('../../transferMonitor/transferApiClient');
const { sendAppSocketEvent } = require('../../transferMonitor/appSocketFrameProbe');
const { recordPendingTransferVerification } = require('../../transferMonitor/autoTransferVerificationStore');
const { sendAutoTransferNoticeSafely } = require('../../transferMonitor/autoTransferNotifier');
const {
  decideTimeoutAutoTransfer,
  resolveStaffGroupLabel
} = require('../../timeoutAutoTransfer/timeoutAutoTransferPolicy');

const TIMEOUT_AUTO_TRANSFER_LOG_MODULE_NAME = "超时自动转接";
const CHAT_ASSIGN_SOCKET_EVENT_NAME = "assignChat";

function formatAssignmentForLog(assignment) {
  // 日志明确写平台当前分配状态；最后接待兜底要带状态说明，不再把“未分配”误写成“未识别”。
  const staffName = String(assignment?.assigneeMember?.staffName || "").trim();
  if (!staffName) {
    return String(assignment?.statusLabel || "").trim();
  }
  if (assignment?.status === ASSIGNMENT_STATUS.LAST_HANDLER) {
    return `${staffName}（${assignment.statusLabel}）`;
  }

  return staffName;
}

async function attemptTimeoutAutoTransfer(options = {}) {
  // 这里把自动转接作为提醒后的附加动作：任何排班/接口异常都只影响转接，不吞掉原有提醒。
  const {
    page,
    scheduleService,
    candidate,
    assignment,
    memberMapByUserId,
    replyConfig,
    now
  } = options;
  if (replyConfig?.timeoutAutoTransferEnabled !== true) {
    return { status: "disabled", reason: "disabled" };
  }
  if (!page || typeof scheduleService?.readDailyShiftMap !== "function") {
    return { status: "skipped", reason: "schedule_service_unavailable" };
  }

  let scheduleData;
  try {
    scheduleData = await scheduleService.readDailyShiftMap(now || new Date());
  } catch (error) {
    logError(
      "主线:失败",
      TIMEOUT_AUTO_TRANSFER_LOG_MODULE_NAME,
      "读取值班排班",
      error
    );
    return {
      status: "failed",
      reason: "schedule_read_failed",
      error
    };
  }

  const decision = decideTimeoutAutoTransfer({
    candidate,
    assignment,
    memberMapByUserId,
    scheduleData,
    config: replyConfig,
    now: now || new Date()
  });
  if (!decision.shouldTransfer) {
    const coloredDutySuffix = Array.isArray(decision.coloredDutyStaffNames)
      ? `，当日带色${resolveStaffGroupLabel(decision.targetStaffGroup)}=${decision.coloredDutyStaffNames.join(" / ") || "无"}`
      : "";
    log(
      "主线:等待",
      TIMEOUT_AUTO_TRANSFER_LOG_MODULE_NAME,
      "跳过自动转接",
      // 跳过也要能审计：记下原接待、所属组、排班班次，方便事后对“为什么没转”对账。
      `客户=${candidate.customerName}，触发=${candidate.reminderKind || "未知"}，原接待=${decision.currentAssigneeName || formatAssignmentForLog(assignment) || "-"}（${resolveStaffGroupLabel(decision.sourceStaffGroup) || "-"}，班次=${decision.currentAssigneeShift || "-"}，当前应值=${decision.expectedShiftStage || "-"}），原因=${decision.reason}${coloredDutySuffix}`
    );
    if (decision.requiresAttention) {
      // 有人该接却没人能接时不能让主管蒙在鼓里，和转接失败共用同一套群通知。
      await sendAutoTransferNoticeSafely({
        outcome: "failed",
        customerName: candidate.customerName,
        sourceStaffName: decision.currentAssigneeName || formatAssignmentForLog(assignment),
        reminderKindLabel: resolveReminderKindLabel(candidate.reminderKind),
        reason: decision.reason
      });
    }
    return {
      status: "skipped",
      reason: decision.reason,
      decision
    };
  }

  let sendResult;
  try {
    sendResult = await sendAppSocketEvent(page, {
      eventName: CHAT_ASSIGN_SOCKET_EVENT_NAME,
      payload: {
        chatId: candidate.chatId,
        groupId: resolveTargetRouteMeta().groupId,
        assigneeId: decision.targetUserId
      }
    });
  } catch (error) {
    if (isLoginRequiredError(error)) {
      throw error;
    }
    logError(
      "主线:失败",
      TIMEOUT_AUTO_TRANSFER_LOG_MODULE_NAME,
      `自动转接失败（客户=${candidate.customerName}，目标=${decision.targetStaffName}）`,
      error
    );
    await sendAutoTransferNoticeSafely({
      outcome: "failed",
      customerName: candidate.customerName,
      sourceStaffName: decision.currentAssigneeName,
      targetStaffName: decision.targetStaffName,
      reminderKindLabel: resolveReminderKindLabel(candidate.reminderKind),
      reason: "assign_request_failed"
    });
    return {
      status: "failed",
      reason: "assign_request_failed",
      decision,
      error
    };
  }

  if (!sendResult.ok) {
    logError(
      "主线:失败",
      TIMEOUT_AUTO_TRANSFER_LOG_MODULE_NAME,
      `自动转接失败（客户=${candidate.customerName}，目标=${decision.targetStaffName}）`,
      new Error(sendResult.message || sendResult.reason)
    );
    await sendAutoTransferNoticeSafely({
      outcome: "failed",
      customerName: candidate.customerName,
      sourceStaffName: decision.currentAssigneeName,
      targetStaffName: decision.targetStaffName,
      reminderKindLabel: resolveReminderKindLabel(candidate.reminderKind),
      reason: sendResult.reason
    });
    return {
      status: "failed",
      reason: sendResult.reason,
      decision,
      sendResult
    };
  }

  const dutySourceLabel = decision.targetDutySource === "group_leader" ? "组长在班" : "值班标记";
  log(
    "主线:执行",
    TIMEOUT_AUTO_TRANSFER_LOG_MODULE_NAME,
    "已发送转接指令",
    `客户=${candidate.customerName}，触发=${candidate.reminderKind}，原接待=${decision.currentAssigneeName}（${decision.sourceStaffGroupLabel}，不在班），目标=${decision.targetStaffName}（${decision.targetStaffGroupLabel}当班，值班来源=${dutySourceLabel}），班次=${decision.expectedShiftStage}，socket序号=${sendResult.socketIndex}，命名空间=${sendResult.namespacePrefix || "默认"}，观察帧数=${sendResult.observedFrameCount}`
  );
  // 指令发出去不等于转成功，按联系人快照确认后才算成功。
  recordPendingTransferVerification({
    chatId: candidate.chatId,
    customerName: candidate.customerName,
    sourceStaffName: decision.currentAssigneeName,
    sourceStaffGroup: decision.sourceStaffGroup,
    targetStaffName: decision.targetStaffName,
    targetUserId: decision.targetUserId,
    targetStaffGroup: decision.targetStaffGroup,
    reminderKind: candidate.reminderKind,
    socketIndex: sendResult.socketIndex
  });
  return {
    status: "sent",
    reason: decision.reason,
    decision,
    sendResult
  };
}

async function processReminderCandidate(runtimeState, candidate, memberMapByUserId, options = {}) {
  // 这里只处理已经达到阈值且这段提醒没发过的候选，同一事件不会循环刷群。
  if (!shouldSendUnresolvedReplyReminder(runtimeState, candidate)) {
    return false;
  }

  const assignment = resolveCurrentAssignment(candidate, memberMapByUserId, {
    lastHandlerSenderName: candidate.lastHandlerSenderName
  });
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
  await attemptTimeoutAutoTransfer({
    page: options.page,
    scheduleService: options.scheduleService,
    candidate,
    assignment,
    memberMapByUserId,
    replyConfig: options.replyConfig,
    now: options.now
  });
  log(
    "主线:完成",
    MISSED_REPLY_LOG_MODULE_NAME,
    "发送提醒",
    `类型=${resolveReminderKindLabel(candidate.reminderKind)}，客户=${candidate.customerName}，原因=${candidate.reasonLabel}，当前分配=${formatAssignmentForLog(assignment)}`
  );
  return true;
}

module.exports = {
  attemptTimeoutAutoTransfer,
  processReminderCandidate
};
