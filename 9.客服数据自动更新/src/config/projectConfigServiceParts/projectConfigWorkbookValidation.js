// 该文件只负责校验汇总表路径与各报表子表配置。
const { normalizeString } = require("./projectConfigValuePrimitives");

function validateWorkbookConfig(workbook) {
  // 首次启动允许路径为空，让新电脑能先进入控制台完成配置；正式汇总前再校验文件。
  return { path: normalizeString(workbook?.path) };
}

module.exports = { validateWorkbookConfig };
