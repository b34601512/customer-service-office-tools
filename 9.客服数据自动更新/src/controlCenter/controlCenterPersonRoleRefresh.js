// 该文件只负责把已保存的客服岗位回填到既有数据明细。
const { createPersonRoleRecord } = require("../shared/personRoles");
const { refreshSummaryDataPersonRoles } = require("../summaryData/summaryDataWriter");

async function refreshDataDetailPersonRoles(projectConfig, dependencies = {}) {
  // 该函数只按当前客服设置更新既有明细的岗位列，不修改业务指标。
  const workbookPath = String(projectConfig?.workbook?.path || "").trim();
  if (!workbookPath) {
    throw new Error("无法更新已有明细岗位：请先保存汇总表文件路径。");
  }

  const refreshSummaryDataPersonRolesFn =
    dependencies.refreshSummaryDataPersonRoles || refreshSummaryDataPersonRoles;
  return refreshSummaryDataPersonRolesFn({
    workbookPath,
    personRoles: createPersonRoleRecord(projectConfig?.globalDefaults?.reportProfiles?.performance?.personMappings)
  });
}

module.exports = {
  refreshDataDetailPersonRoles
};
