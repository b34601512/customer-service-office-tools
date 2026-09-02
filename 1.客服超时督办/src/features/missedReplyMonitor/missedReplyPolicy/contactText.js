// 该文件用于清洗漏回复策略里的联系人字段。
function normalizeContactText(value) {
  // 这里统一清洗联系人字段，避免空格导致 chatId 和客户名无法匹配。
  return String(value || "").trim();
}

module.exports = {
  normalizeContactText
};
