// 该文件用于统计未实质回复单轮扫描结果，供摘要日志使用。
function buildScanSummary(contactCount, scannedCount) {
  // 这里统一初始化单轮摘要，日志字段固定，避免后续新增统计时漏字段。
  return {
    contactCount,
    scannedCount,
    timeoutCandidateCount: 0,
    missedReplyCandidateCount: 0,
    timeoutSentCount: 0,
    missedReplySentCount: 0,
    suppressedCount: 0,
    resolvedCount: 0,
    latestCandidateName: "",
    decisionReasonCounts: {}
  };
}

function incrementReminderCandidateSummary(summary, candidate) {
  // 这里按当前应发提醒段统计候选数量，避免旧的短长双轨重复计数。
  if (candidate.reminderKind === "timeout") {
    summary.timeoutCandidateCount += 1;
  } else if (candidate.reminderKind === "missedReply") {
    summary.missedReplyCandidateCount += 1;
  }
  summary.latestCandidateName ||= candidate.customerName;
}

function incrementReminderSentSummary(summary, candidate) {
  // 这里按实际发送成功的提醒段统计结果。
  if (candidate.reminderKind === "timeout") {
    summary.timeoutSentCount += 1;
  } else if (candidate.reminderKind === "missedReply") {
    summary.missedReplySentCount += 1;
  }
}

module.exports = {
  buildScanSummary,
  incrementReminderCandidateSummary,
  incrementReminderSentSummary
};
