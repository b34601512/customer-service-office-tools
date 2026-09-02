const { requireCompleteKdocsSyncSettings } = require("./kdocsSyncSettings");
const { readDataSourceWorkbook } = require("./dataSourceWorkbookReader");
const { executeKdocsAirScriptSync } = require("./kdocsAirScriptClient");

const KDOCS_WRITE_SCRIPT_VERSION = "2026-08-24.platform-metric.1";

async function syncDataSourceToKdocs({ projectConfig, requestImplementation }) {
  const syncSettings = requireCompleteKdocsSyncSettings(projectConfig?.kdocsDataSourceSync);
  const localDataSource = await readDataSourceWorkbook(projectConfig?.workbook?.path);
  const remoteResult = await executeKdocsAirScriptSync({
    webhookUrl: syncSettings.webhookUrl,
    apiToken: syncSettings.apiToken,
    contextArguments: {
      operationType: "replace_data_source",
      dataSourceRows: localDataSource.dataSourceRows,
      expectedDataRowCount: localDataSource.dataRowCount,
      expectedColumnCount: localDataSource.columnCount,
      requiredScriptVersion: KDOCS_WRITE_SCRIPT_VERSION
    },
    requestImplementation
  });
  const actualVersion = String(remoteResult?.scriptVersion || "").trim();
  if (actualVersion !== KDOCS_WRITE_SCRIPT_VERSION) {
    throw new Error(
      `在线写入脚本版本不匹配（需要 ${KDOCS_WRITE_SCRIPT_VERSION}，` +
      `在线返回${actualVersion || "旧版无版本号"}），请用菜单[3]覆盖并保存。 `
    );
  }
  if (remoteResult.operationType !== "replace_data_source") {
    throw new Error("在线 AirScript 还是旧版本，请用菜单[3]重新粘贴最新脚本。 ");
  }
  if (
    Number(remoteResult.verifiedDataRowCount) !== localDataSource.dataRowCount ||
    Number(remoteResult.verifiedColumnCount) !== localDataSource.columnCount
  ) {
    throw new Error(
      `在线镜像数量不一致：本地${localDataSource.dataRowCount}行${localDataSource.columnCount}列，` +
      `在线返回${remoteResult.verifiedDataRowCount ?? "未知"}行${remoteResult.verifiedColumnCount ?? "未知"}列。 `
    );
  }
  if (Number(remoteResult.mismatchCellCount) !== 0) {
    throw new Error("在线数据与本地不完全一致，本次同步失败。 ");
  }
  const auditedRowCount = Number(remoteResult.auditedRowCount);
  const auditedColumnCount = Number(remoteResult.auditedColumnCount);
  if (
    !Number.isInteger(auditedRowCount) || auditedRowCount < localDataSource.dataSourceRows.length ||
    !Number.isInteger(auditedColumnCount) || auditedColumnCount < localDataSource.columnCount
  ) {
    throw new Error("在线脚本没有完整核验整张数据源。 ");
  }
  if (remoteResult.saveCompleted !== true) {
    throw new Error("在线数据源没有保存完成。 ");
  }
  return {
    localDataRowCount: localDataSource.dataRowCount,
    remoteDataRowCount: Number(remoteResult.verifiedDataRowCount),
    mismatchCellCount: Number(remoteResult.mismatchCellCount),
    auditedRowCount,
    auditedColumnCount,
    documentUrl: syncSettings.documentUrl
  };
}

module.exports = { KDOCS_WRITE_SCRIPT_VERSION, syncDataSourceToKdocs };
