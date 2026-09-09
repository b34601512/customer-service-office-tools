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
const { assignChatToMember } = require('../../transferMonitor/transferApiClient');
const { decideTimeoutAutoTransfer } = require('../../timeoutAutoTransfer/timeoutAutoTransferPolicy');

const TIMEOUT_AUTO_TRANSFER_LOG_MODULE_NAME = "超时自动转接";

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
    log(
      "主线:等待",
      TIMEOUT_AUTO_TRANSFER_LOG_MODULE_NAME,
      "跳过自动转接",
      `客户=${candidate.customerName}，触发=${candidate.reminderKind || "未知"}，原因=${decision.reason}`
    );
    return {
      status: "skipped",
      reason: decision.reason,
      decision
    };
  }

  try {
    const transferResult = await assignChatToMember(
      page,
      candidate.chatId,
      decision.targetUserId,
      {
        logModuleName: TIMEOUT_AUTO_TRANSFER_LOG_MODULE_NAME
      }
    );
    log(
      "主线:完成",
      TIMEOUT_AUTO_TRANSFER_LOG_MODULE_NAME,
      "自动转接成功",
      `客户=${candidate.customerName}，触发=${candidate.reminderKind}，原接待=${decision.currentAssigneeName}，目标=${decision.targetStaffName}，班次=${decision.expectedShiftStage}，背景色=${decision.targetBackgroundColor}`
    );
    return {
      status: "succeeded",
      reason: decision.reason,
      decision,
      transferResult
    };
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
    return {
      status: "failed",
      reason: "assign_request_failed",
      decision,
      error
    };
  }
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
