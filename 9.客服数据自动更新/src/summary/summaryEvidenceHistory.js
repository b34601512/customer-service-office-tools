// 该文件只负责校验源表历史中已经明确绑定的成功凭证。
const fs = require("fs");

function listExistingEvidenceFiles(evidenceFiles) {
  // 这个函数只保留源表记录中明确绑定且仍存在的凭证，不再根据目录猜测历史截图。
  return (Array.isArray(evidenceFiles) ? evidenceFiles : []).filter((item) => {
    const filePath = String(item?.filePath || "").trim();
    return filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  });
}

module.exports = { listExistingEvidenceFiles };
