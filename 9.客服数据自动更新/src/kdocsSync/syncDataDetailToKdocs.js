const crypto = require("crypto");
const fs = require("fs");
const { requireCompleteKdocsSyncSettings } = require("./kdocsSyncSettings");
const {
  readDataDetailWorkbook,
  normalizeKdocsDataDetailRows
} = require("./dataDetailWorkbookReader");
const { executeKdocsAirScriptSync } = require("./kdocsAirScriptClient");
const { appendKdocsSyncReceipt } = require("./kdocsSyncReceiptStore");
const {
  KDOCS_SYNC_AIRSCRIPT_VERSION,
  KDOCS_FULL_SYNC_OPERATION,
  requireCurrentKdocsAirScriptVersion,
  sanitizeKdocsDiagnosticText
} = require("./kdocsSyncContract");

function calculateWorkbookSha256(workbookPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(workbookPath)).digest("hex");
}

function requireIntegerResult(value, fieldLabel, minimumValue = 0) {
  const normalizedValue = Number(value);
  if (!Number.isInteger(normalizedValue) || normalizedValue < minimumValue) {
    throw new Error(`在线真实回读的${fieldLabel}无效。 `);
  }
  return normalizedValue;
}

function validateRemoteSyncResult(remoteResult, localDataDetail) {
  requireCurrentKdocsAirScriptVersion(remoteResult, KDOCS_SYNC_AIRSCRIPT_VERSION);
  if (remoteResult.operationType !== KDOCS_FULL_SYNC_OPERATION) {
    throw new Error("在线 AirScript 没有执行同步脚本，请用菜单[3]覆盖并保存。 ");
  }

  const readBackDataRowCount = requireIntegerResult(remoteResult.readBackDataRowCount, "数据行数");
  const readBackLastRowNumber = requireIntegerResult(remoteResult.readBackLastRowNumber, "最后一行", 2);
  const expectedLastRowNumber = localDataDetail.dataRowCount + 1;
  const dataRangeAddress = String(remoteResult.dataRangeAddress || "").trim().toUpperCase();
  if (
    remoteResult.readBackMatched !== true ||
    readBackDataRowCount !== localDataDetail.dataRowCount ||
    readBackLastRowNumber !== expectedLastRowNumber ||
    dataRangeAddress !== `A1:X${expectedLastRowNumber}`
  ) {
    throw new Error("在线“数据明细”整表真实回读与本地数据不一致。 ");
  }
  if (remoteResult.saveCompleted !== true) throw new Error("在线工作簿没有保存完成。 ");

  return {
    scriptVersion: KDOCS_SYNC_AIRSCRIPT_VERSION,
    localDataRowCount: localDataDetail.dataRowCount,
    remoteDataRowCount: readBackDataRowCount,
    remoteLastRowNumber: readBackLastRowNumber,
    dataRangeAddress,
    clearedTailRowCount: requireIntegerResult(remoteResult.clearedTailRowCount || 0, "清理旧尾行数")
  };
}

function selectRemoteReceiptFacts(remoteResult) {
  if (!remoteResult || typeof remoteResult !== "object") return null;
  return {
    scriptVersion: String(remoteResult.scriptVersion || ""),
    operationType: String(remoteResult.operationType || ""),
    readBackDataRowCount: remoteResult.readBackDataRowCount,
    readBackLastRowNumber: remoteResult.readBackLastRowNumber,
    readBackMatched: remoteResult.readBackMatched,
    dataRangeAddress: remoteResult.dataRangeAddress,
    saveCompleted: remoteResult.saveCompleted
  };
}

function buildKdocsSyncReceipt({
  status,
  createdAt,
  workbookPath,
  workbookSha256,
  localDataDetail,
  remoteResult,
  errorMessage
}) {
  return {
    createdAt,
    status,
    workbookPath: String(workbookPath || ""),
    workbookSha256: String(workbookSha256 || ""),
    local: localDataDetail ? {
      dataRowCount: localDataDetail.dataRowCount,
      columnCount: localDataDetail.columnCount,
      lastRowNumber: localDataDetail.lastRowNumber,
      targetRangeAddress: localDataDetail.targetRangeAddress,
      endDateRowCounts: localDataDetail.endDateRowCounts
    } : null,
    remote: selectRemoteReceiptFacts(remoteResult),
    errorMessage: sanitizeKdocsDiagnosticText(errorMessage)
  };
}

function normalizeKdocsSyncError(error) {
  const safeMessage = sanitizeKdocsDiagnosticText(error?.message || error);
  if (/不支持的操作|旧版无版本号|AirScript\s*版本不匹配|没有返回(?:写入|执行)结果/.test(safeMessage)) {
    return new Error(
      `在线 AirScript 是旧版本，已拒绝本次操作；请用菜单[3]覆盖同步脚本、菜单[6]覆盖筛选脚本、菜单[8]覆盖客服姓名脚本并按 Ctrl+S 保存。 `
    );
  }
  return new Error(safeMessage || "金山文档同步失败。 ");
}

async function syncDataDetailToKdocs({
  projectConfig,
  requestImplementation,
  readDataDetailWorkbookImplementation = readDataDetailWorkbook,
  executeAirScriptImplementation = executeKdocsAirScriptSync,
  receiptWriter = appendKdocsSyncReceipt,
  calculateWorkbookSha256Implementation = calculateWorkbookSha256,
  nowImplementation = () => new Date()
}) {
  const workbookPath = projectConfig?.workbook?.path;
  const createdAt = nowImplementation().toISOString();
  let localDataDetail = null;
  let workbookSha256 = "";
  let remoteResult = null;
  let receiptPersisted = false;
  try {
    const syncSettings = requireCompleteKdocsSyncSettings(projectConfig?.kdocsDataDetailSync, "sync");
    localDataDetail = await readDataDetailWorkbookImplementation(workbookPath);
    workbookSha256 = await calculateWorkbookSha256Implementation(workbookPath);
    remoteResult = await executeAirScriptImplementation({
      webhookUrl: syncSettings.webhookUrl,
      apiToken: syncSettings.apiToken,
      contextArguments: {
        operationType: KDOCS_FULL_SYNC_OPERATION,
        requiredScriptVersion: KDOCS_SYNC_AIRSCRIPT_VERSION,
        dataDetailRows: normalizeKdocsDataDetailRows(localDataDetail.dataDetailRows)
      },
      requestImplementation
    });
    const syncResult = validateRemoteSyncResult(remoteResult, localDataDetail);
    await receiptWriter(buildKdocsSyncReceipt({
      status: "success",
      createdAt,
      workbookPath,
      workbookSha256,
      localDataDetail,
      remoteResult,
      errorMessage: ""
    }));
    receiptPersisted = true;
    return syncResult;
  } catch (error) {
    const normalizedError = normalizeKdocsSyncError(error);
    if (!receiptPersisted) {
      try {
        await receiptWriter(buildKdocsSyncReceipt({
          status: "failed",
          createdAt,
          workbookPath,
          workbookSha256,
          localDataDetail,
          remoteResult,
          errorMessage: normalizedError.message
        }));
      } catch (_receiptError) {
        // 回执写入失败不能覆盖更早发生的同步错误。
      }
    }
    throw normalizedError;
  }
}

module.exports = {
  calculateWorkbookSha256,
  validateRemoteSyncResult,
  selectRemoteReceiptFacts,
  buildKdocsSyncReceipt,
  normalizeKdocsSyncError,
  syncDataDetailToKdocs
};
