// 该文件用于关闭成员下班前仍会接新流量的开关。
const {
  readMemberRow,
  setMemberAutoAssign,
  setMemberTransferEnabled
} = require("../memberSettingsPage");

async function disableMemberForOffDuty(page, candidate) {
  // 这里统一先关闭会接新流量的开关，避免我们处理旧会话时又继续进新客户。
  const actions = [];
  const failedActions = [];
  const initialRow = await readMemberRow(page, candidate.staffName);
  if (initialRow.autoAssignEnabled) {
    await setMemberAutoAssign(page, candidate.staffName, false);
    actions.push("关闭自动分配");
  }

  if (initialRow.transferEnabled) {
    await setMemberTransferEnabled(page, candidate.staffName, false);
    actions.push("关闭是否可被转接");
  }

  // 点击后必须重新读一次：只有真的变成关闭态才算完成，否则不能对外说“已关闭”。
  const latestRow = await readMemberRow(page, candidate.staffName);
  if (initialRow.autoAssignEnabled && latestRow.autoAssignEnabled) {
    failedActions.push("自动分配");
  }

  if (initialRow.transferEnabled && latestRow.transferEnabled) {
    failedActions.push("是否可被转接");
  }

  return {
    actions,
    row: latestRow,
    failedActions
  };
}

module.exports = {
  disableMemberForOffDuty
};
