// 该文件用于生成未实质回复单轮扫描摘要日志，避免高频日志刷屏。
const { log } = require('../../../engine/logger');
const { MISSED_REPLY_LOG_MODULE_NAME } = require('./constants');

function incrementDecisionReasonCount(summary, decision) {
  // 这里按原因汇总本轮结果，日志只打一行摘要，避免每分钟刷出几十行客户记录。
  const reason = String(decision?.reason || decision?.reasonLabel || "未说明原因").trim() || "未说明原因";
  summary.decisionReasonCounts[reason] = Number(summary.decisionReasonCounts[reason] || 0) + 1;
}

function formatDecisionReasonSummary(reasonCounts) {
  // 这里把原因统计压成短句，方便实时日志一眼看到本轮为什么没产生候选。
  const entries = Object.entries(reasonCounts || {})
    .sort((left, right) => Number(right[1]) - Number(left[1]));
  if (entries.length === 0) {
    return "暂无";
  }

  const visibleEntries = entries.slice(0, 4).map(([reason, count]) => `${reason}=${count}`);
  const hiddenCount = entries.slice(4).reduce((total, [, count]) => total + Number(count || 0), 0);
  return hiddenCount > 0 ? `${visibleEntries.join("，")}，其他=${hiddenCount}` : visibleEntries.join("，");
}

function logMissedReplySummary(runtimeState, summary) {
  // 这里只在摘要变化时打印一次，避免每分钟重复刷同样的终端日志。
  const decisionReasonSummary = formatDecisionReasonSummary(summary.decisionReasonCounts);
  const summaryKey = [
    summary.contactCount,
    summary.scannedCount,
    summary.timeoutCandidateCount,
    summary.missedReplyCandidateCount,
    summary.timeoutSentCount,
    summary.missedReplySentCount,
    summary.suppressedCount,
    summary.resolvedCount,
    summary.latestCandidateName || "none",
    decisionReasonSummary
  ].join("|");
  if (runtimeState.lastSummaryKey === summaryKey) {
    return;
  }

  runtimeState.lastSummaryKey = summaryKey;
  log(
    "主线:执行",
    MISSED_REPLY_LOG_MODULE_NAME,
    "刷新任务视图",
    `联系人=${summary.contactCount}，本轮扫描=${summary.scannedCount}，超时候选=${summary.timeoutCandidateCount}，漏回复候选=${summary.missedReplyCandidateCount}，超时提醒=${summary.timeoutSentCount}，漏回复提醒=${summary.missedReplySentCount}，已提醒不重复=${summary.suppressedCount}，已恢复=${summary.resolvedCount}，判定=${decisionReasonSummary}${summary.latestCandidateName ? `，最新候选=${summary.latestCandidateName}` : ""}`
  );
}

module.exports = {
  incrementDecisionReasonCount,
  logMissedReplySummary
};
