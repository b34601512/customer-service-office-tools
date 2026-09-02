// 该文件用于维护控制台唯一倒计时快照，隐藏已完成提醒的旧倒计时。
const {
  clearUnresolvedReplyCountdownItem,
  setUnresolvedReplyCountdownItem
} = require('../missedReplyStateStore');
const { buildUnresolvedReplyCountdownItem } = require('./decisionPresenter');

function updateCountdownSnapshot(runtimeState, reminderDecision, nowMs) {
  // 这里维护唯一倒计时快照：没到首次看首次，首次发过看漏回复，漏回复发过就清空。
  const countdownItem = buildUnresolvedReplyCountdownItem(reminderDecision, runtimeState, nowMs);
  if (countdownItem) {
    setUnresolvedReplyCountdownItem(runtimeState, countdownItem);
    return;
  }

  clearUnresolvedReplyCountdownItem(runtimeState, reminderDecision.chatId);
}

module.exports = {
  updateCountdownSnapshot
};
