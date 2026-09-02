// 该文件用于关闭成员下班前仍会接新流量的开关。
const {
  readMemberRow,
  setMemberAutoAssign,
  setMemberTransferEnabled
} = require("../memberSettingsPage");

async function disableMemberForOffDuty(page, candidate) {
  // 这里统一先关闭会接新流量的开关，避免我们处理旧会话时又继续进新客户。
  const actions = [];
  const initialRow = await readMemberRow(page, candidate.staffName);
  if (initialRow.autoAssignEnabled) {
    await setMemberAutoAssign(page, candidate.staffName, false);
    actions.push("关闭自动分配");
  }

  if (initialRow.transferEnabled) {
    await setMemberTransferEnabled(page, candidate.staffName, false);
    actions.push("关闭是否可被转接");
  }

  const latestRow = await readMemberRow(page, candidate.staffName);
  return {
    actions,
    row: latestRow
  };
}

module.exports = {
  disableMemberForOffDuty
};
