// 该文件是漏回复状态仓库的公共入口，具体状态能力拆到 missedReplyStateStore 目录。
const { buildEmptyMissedReplyMonitorState } = require("./missedReplyStateStore/stateShape");
const {
  clearResolvedMissedReplyState,
  hasReminderKindBeenSent,
  markUnresolvedReplyReminderSent,
  shouldSendUnresolvedReplyReminder
} = require("./missedReplyStateStore/reminderSentState");
const { getReminderEvent } = require("./missedReplyStateStore/reminderIdentity");
const {
  readMissedReplyMonitorState,
  writeMissedReplyMonitorState
} = require("./missedReplyStateStore/stateFile");
const {
  clearUnresolvedReplyReminderSnapshot,
  setUnresolvedReplyReminderSnapshot
} = require("./missedReplyStateStore/reminderSnapshot");
const {
  clearUnresolvedReplyCountdownItem,
  setUnresolvedReplyCountdownItem
} = require("./missedReplyStateStore/countdownItem");
const {
  clearUnresolvedReplyDecisionItem,
  setUnresolvedReplyDecisionItem
} = require("./missedReplyStateStore/decisionItem");

module.exports = {
  buildEmptyMissedReplyMonitorState,
  clearResolvedMissedReplyState,
  clearUnresolvedReplyCountdownItem,
  clearUnresolvedReplyDecisionItem,
  clearUnresolvedReplyReminderSnapshot,
  getReminderEvent,
  hasReminderKindBeenSent,
  markUnresolvedReplyReminderSent,
  readMissedReplyMonitorState,
  shouldSendUnresolvedReplyReminder,
  setUnresolvedReplyCountdownItem,
  setUnresolvedReplyDecisionItem,
  setUnresolvedReplyReminderSnapshot,
  writeMissedReplyMonitorState
};
