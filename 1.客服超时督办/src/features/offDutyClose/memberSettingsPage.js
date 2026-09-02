// 该文件是成员设置页操作公共入口，具体页面动作拆到 memberSettingsPage 目录。
const { ensureMemberSettingsView, reloadMemberSettingsView } = require("./memberSettingsPage/view");
const { parseMemberNameCellText } = require("./memberSettingsPage/text");
const { readMemberRow } = require("./memberSettingsPage/rowReader");
const {
  setMemberAutoAssign,
  setMemberTransferEnabled
} = require("./memberSettingsPage/memberSwitch");
const { waitForConversationCountAtMost } = require("./memberSettingsPage/conversationCount");

module.exports = {
  ensureMemberSettingsView,
  reloadMemberSettingsView,
  parseMemberNameCellText,
  readMemberRow,
  setMemberAutoAssign,
  setMemberTransferEnabled,
  waitForConversationCountAtMost
};
