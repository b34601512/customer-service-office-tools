// 该文件负责「交班补判」：客户还在等回复、而原接待已经下班（或没上线）时，后台主动再判一次该不该转接。
// 用户口径（2026-09-16）：“空档2要加，交接的时候容易出问题”。
// 产生空档的原因：提醒可能在原接待还在班时就发过了，等他下班后不会再有新提醒，
// 客户会一直挂在下班的人名下；所以这里按固定节奏对“还在等回复”的会话补判一次。
const { log } = require("../../engine/logger");
const { ASSIGNMENT_STATUS } = require("../shared/currentAssignment");
const { attemptTimeoutAutoTransfer } = require("../missedReplyMonitor/missedReplyWorkflow/reminderProcessor");
const {
  readAutoTransferSweepLedger,
  recordAutoTransferSweepAttempt
} = require("./autoTransferSweepLedger");

const AUTO_TRANSFER_LOG_MODULE_NAME = "超时自动转接";
const SHIFT_HANDOVER_REMINDER_KIND = "shiftHandover";
// 补判节奏：每 5 分钟看一次；同一个客户 30 分钟内最多真正处理一次（换人了可以立刻重判）。
const SHIFT_HANDOVER_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SHIFT_HANDOVER_RETRY_INTERVAL_MS = 30 * 60 * 1000;
const SHIFT_HANDOVER_MAX_CANDIDATES_PER_RUN = 5;

function normalizeStaffName(value) {
  return String(value || "").trim();
}

function isWaitingForReply(decisionItem) {
  // 客户还在等回复：客户没被人工实质回复，超时/漏回复两种责任都还没结掉。
  return Boolean(
    decisionItem?.isPendingTimeoutReplyCandidate === true ||
    decisionItem?.isPendingMissedReplyCandidate === true
  );
}

function listShiftHandoverCandidates(input = {}) {
  // 候选 = 真的分配到人的会话 + 客户还在等回复 + 不在冷却窗口内（或原接待已经换人）。
  const { decisionItemsByChatId, memberMapByUserId, ledger, nowMs = Date.now() } = input;
  const attemptsByChatId = ledger?.attemptsByChatId || {};

  return Object.values(decisionItemsByChatId || {})
    .filter((item) => item && normalizeStaffName(item.chatId))
    .filter((item) => item.assignmentStatus === ASSIGNMENT_STATUS.ASSIGNED)
    .filter((item) => normalizeStaffName(item.assignedToUserId))
    .filter((item) => isWaitingForReply(item))
    .map((item) => {
      const assigneeUserId = normalizeStaffName(item.assignedToUserId);
      // 拿不到成员角色就不知道属于售前还是售后，宁可不猜。
      const assigneeMember = memberMapByUserId?.[assigneeUserId] || null;
      if (!assigneeMember) {
        return null;
      }

      const lastAttempt = attemptsByChatId[item.chatId] || null;
      const assigneeChanged = Boolean(
        lastAttempt && normalizeStaffName(lastAttempt.assigneeUserId) !== assigneeUserId
      );
      const cooldownPassed = !lastAttempt ||
        (nowMs - Number(lastAttempt.attemptedAtMs || 0)) >= SHIFT_HANDOVER_RETRY_INTERVAL_MS;
      if (lastAttempt && !assigneeChanged && !cooldownPassed) {
        return null;
      }

      return {
        chatId: item.chatId,
        customerName: item.customerName,
        assigneeUserId,
        candidate: {
          chatId: item.chatId,
          customerName: item.customerName,
          reminderKind: SHIFT_HANDOVER_REMINDER_KIND
        },
        assignment: {
          assignedToUserId: assigneeUserId,
          status: ASSIGNMENT_STATUS.ASSIGNED,
          assigneeMember: {
            userId: assigneeUserId,
            staffName: assigneeMember.staffName,
            staffGroup: assigneeMember.staffGroup
          }
        }
      };
    })
    .filter(Boolean)
    .slice(0, SHIFT_HANDOVER_MAX_CANDIDATES_PER_RUN);
}

async function runShiftHandoverSweep(input = {}) {
  // 一轮补判：只对真正等回复且没有冷却的客户走一遍完整转接判定（含发送、核验、通知）。
  const {
    page,
    scheduleService,
    memberMapByUserId,
    replyConfig,
    decisionItemsByChatId,
    now = new Date(),
    ledger = readAutoTransferSweepLedger()
  } = input;

  if (replyConfig?.timeoutAutoTransferEnabled !== true) {
    return { status: "disabled", candidateCount: 0, handledCount: 0 };
  }
  if (!page || !scheduleService) {
    return { status: "not_ready", candidateCount: 0, handledCount: 0 };
  }

  const candidates = listShiftHandoverCandidates({
    decisionItemsByChatId,
    memberMapByUserId,
    ledger,
    nowMs: now.getTime()
  });
  if (candidates.length === 0) {
    return { status: "no_candidate", candidateCount: 0, handledCount: 0 };
  }

  let handledCount = 0;
  for (const item of candidates) {
    const result = await attemptTimeoutAutoTransfer({
      page,
      scheduleService,
      candidate: item.candidate,
      assignment: item.assignment,
      memberMapByUserId,
      replyConfig,
      now
    });
    const decision = result?.decision || null;
    // 只记“真的动了手”的尝试：转接已发出、或者已经@主管告警。
    const shouldRecord = decision?.shouldTransfer === true || decision?.requiresAttention === true;
    if (!shouldRecord) {
      continue;
    }

    handledCount += 1;
    recordAutoTransferSweepAttempt({
      chatId: item.chatId,
      customerName: item.customerName,
      assigneeUserId: item.assigneeUserId,
      targetStaffName: decision?.targetStaffName || "",
      outcome: decision?.shouldTransfer ? String(result?.status || "sent") : "attention",
      reason: String(decision?.reason || ""),
      attemptedAtMs: now.getTime()
    });
  }

  log(
    "主线:执行",
    AUTO_TRANSFER_LOG_MODULE_NAME,
    "交班补判",
    `候选=${candidates.length}，已处理=${handledCount}`
  );
  return { status: "done", candidateCount: candidates.length, handledCount };
}

module.exports = {
  SHIFT_HANDOVER_MAX_CANDIDATES_PER_RUN,
  SHIFT_HANDOVER_REMINDER_KIND,
  SHIFT_HANDOVER_RETRY_INTERVAL_MS,
  SHIFT_HANDOVER_SWEEP_INTERVAL_MS,
  isWaitingForReply,
  listShiftHandoverCandidates,
  runShiftHandoverSweep
};
