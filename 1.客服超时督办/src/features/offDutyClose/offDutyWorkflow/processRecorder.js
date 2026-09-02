// 该文件用于把下班处理过程写入主管过程看板。
const { appendSupervisorProcessRecord } = require("../../supervision/supervisionReport");
const {
  OFF_DUTY_MODE_NAME,
  OFF_DUTY_PROMPT_TRACE
} = require("../offDutyConfig");

function recordOffDutyProcess(candidate, statusLabel, reason, extra = {}) {
  // 这里把下班处理动作也落进现有过程看板，方便网页端直接回看。
  appendSupervisorProcessRecord({
    occurredAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    customerName: candidate.staffName,
    statusLabel,
    modeName: OFF_DUTY_MODE_NAME,
    promptTrace: OFF_DUTY_PROMPT_TRACE,
    queueRawText: "",
    queuePreviewText: "",
    queueTimeText: candidate.closeTimeText,
    waitMarkerText: candidate.shiftLabel,
    lastCustomerMessage: "",
    recentAgentReply: "",
    customerContext: `明天班次：${candidate.tomorrowShiftLabel}`,
    reason,
    pendingDurationSeconds: Number.isFinite(Number(extra.pendingConversationCount))
      ? Number(extra.pendingConversationCount)
      : candidate.currentConversationCount,
    assigneeName: extra.assigneeName || "",
    assigneeRoleLabel: candidate.roleLabel || "",
    escalationStatus: extra.escalationStatus || "未通知",
    escalationWebhookName: extra.escalationWebhookName || "",
    dispatchAction: extra.dispatchAction || "off_duty_close",
    dispatchTarget: extra.dispatchTarget || "",
    dispatchRawText: extra.dispatchRawText || "",
    messages: []
  });
}

module.exports = {
  recordOffDutyProcess
};
