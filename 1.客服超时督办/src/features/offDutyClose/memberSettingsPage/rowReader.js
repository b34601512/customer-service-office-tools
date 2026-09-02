// 该文件用于读取并校验指定成员当前状态。
const { ensureMemberSettingsView } = require("./view");
const { searchMember } = require("./search");
const { readVisibleMemberRows } = require("./visibleRows");
const { parseMemberNameCellText } = require("./text");

function normalizeResolvedMemberRow(row, staffName) {
  // 这里统一校验目标成员行是否真的渲染完整，不完整就直接抛错，防止误判成已关闭。
  if (!row) {
    throw new Error(`成员设置页没有找到客服「${staffName}」。`);
  }

  if (Number(row.switchCount || 0) < 2) {
    throw new Error(`客服「${staffName}」所在成员行开关尚未渲染完整，当前开关数=${row.switchCount || 0}。`);
  }

  if (!row.hasConversationCount) {
    throw new Error(`客服「${staffName}」所在成员行接待人数尚未渲染完成。`);
  }

  const parsedName = parseMemberNameCellText(row.nameCellText);
  return {
    ...row,
    memberName: parsedName.memberName,
    roleLabel: parsedName.roleLabel
  };
}

async function readMemberRow(page, staffName) {
  // 这里统一读取指定成员当前状态，不命中就直接抛错，避免误操作到别的成员。
  await ensureMemberSettingsView(page);
  await searchMember(page, staffName);
  const rows = await readVisibleMemberRows(page);
  const matchedRow = rows.find((row) => parseMemberNameCellText(row.nameCellText).memberName === staffName);
  if (!matchedRow) {
    await searchMember(page, staffName);
    const retriedRows = await readVisibleMemberRows(page);
    const retriedMatchedRow = retriedRows.find(
      (row) => parseMemberNameCellText(row.nameCellText).memberName === staffName
    );
    if (retriedMatchedRow) {
      return normalizeResolvedMemberRow(retriedMatchedRow, staffName);
    }

    throw new Error(`成员设置页没有找到客服「${staffName}」。`);
  }

  return normalizeResolvedMemberRow(matchedRow, staffName);
}

module.exports = {
  normalizeResolvedMemberRow,
  readMemberRow
};
