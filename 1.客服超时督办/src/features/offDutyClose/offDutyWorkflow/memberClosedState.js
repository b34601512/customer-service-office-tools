// 该文件用于判断成员是否已经处于下班关闭态。
function buildSilentCompletionReason(candidate) {
  return `客服=${candidate.staffName} 当前已是关闭态，后台仅同步完成状态。明天班次=${candidate.tomorrowShiftLabel}`;
}

function isMemberAlreadyClosed(row) {
  // 这里统一判断成员当前是否真的处于下班关闭态，避免流程层到处手写同一组条件。
  return (
    Number(row.currentConversationCount || 0) === 0 &&
    !row.autoAssignEnabled &&
    !row.transferEnabled
  );
}

module.exports = {
  buildSilentCompletionReason,
  isMemberAlreadyClosed
};
