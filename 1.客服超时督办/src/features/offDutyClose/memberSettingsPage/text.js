// 该文件用于清洗和解析成员设置页姓名单元格。
const { parseStaffDisplayName } = require("../../shared/staffIdentity");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseMemberNameCellText(rawText) {
  // 这里统一拆成员姓名和角色，避免后续规则层直接啃页面原始文本。
  return parseStaffDisplayName(normalizeText(rawText));
}

module.exports = {
  normalizeText,
  parseMemberNameCellText
};
