const { requireCompleteKdocsSyncSettings } = require("./kdocsSyncSettings");
const { executeKdocsAirScriptSync } = require("./kdocsAirScriptClient");
const { readDataDetailWorkbook } = require("./dataDetailWorkbookReader");
const {
  KDOCS_FILTER_AIRSCRIPT_VERSION,
  KDOCS_PIVOT_FILTER_OPERATION,
  requireCurrentKdocsAirScriptVersion
} = require("./kdocsSyncContract");

function isValidPivotFilterDate(dateText) {
  const matchedDate = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matchedDate) return false;
  const year = Number(matchedDate[1]);
  const month = Number(matchedDate[2]);
  const day = Number(matchedDate[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day
  );
}

function requireValidPivotFilterDate(dateText) {
  const normalizedDate = String(dateText || "").trim();
  if (!isValidPivotFilterDate(normalizedDate)) {
    throw new Error("筛选日期无效，请按 YYYY-MM-DD 输入真实日期。 ");
  }
  return normalizedDate;
}

async function resolvePivotFilterDateInput({
  dateInput,
  workbookPath,
  readDataDetailWorkbookImplementation = readDataDetailWorkbook
} = {}) {
  const customDate = String(dateInput || "").trim();
  if (customDate) return requireValidPivotFilterDate(customDate);

  const localDataDetail = await readDataDetailWorkbookImplementation(workbookPath);
  return requireValidPivotFilterDate(localDataDetail.maxEndDateText);
}

function resolveExcelDateSerial(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  const excelEpochUtc = Date.UTC(1899, 11, 30);
  return (Date.UTC(year, month - 1, day) - excelEpochUtc) / 86400000;
}

async function updateKdocsPivotEndDateFilter({
  projectConfig,
  filterDate,
  requestImplementation,
  readDataDetailWorkbookImplementation = readDataDetailWorkbook
}) {
  const syncSettings = requireCompleteKdocsSyncSettings(projectConfig?.kdocsDataDetailSync, "filter");
  const requestedFilterDate = await resolvePivotFilterDateInput({
    dateInput: filterDate,
    workbookPath: projectConfig?.workbook?.path,
    readDataDetailWorkbookImplementation
  });
  let remoteResult;
  try {
    remoteResult = await executeKdocsAirScriptSync({
      webhookUrl: syncSettings.webhookUrl,
      apiToken: syncSettings.apiToken,
      contextArguments: {
        operationType: KDOCS_PIVOT_FILTER_OPERATION,
        requiredScriptVersion: KDOCS_FILTER_AIRSCRIPT_VERSION,
        pivotFilterDate: requestedFilterDate,
        pivotFilterDateSerial: resolveExcelDateSerial(requestedFilterDate)
      },
      requestImplementation
    });
  } catch (error) {
    if (/不支持的操作|AirScript\s*版本不匹配|没有返回(?:写入|执行)结果/.test(String(error?.message || error))) {
      throw new Error(
        `在线 AirScript 是旧版本，已拒绝本次操作；请用菜单[6]覆盖筛选脚本并保存。 `
      );
    }
    throw error;
  }
  requireCurrentKdocsAirScriptVersion(remoteResult, KDOCS_FILTER_AIRSCRIPT_VERSION);
  if (remoteResult.operationType !== KDOCS_PIVOT_FILTER_OPERATION) {
    throw new Error("在线 AirScript 没有执行筛选脚本，请用菜单[6]覆盖并保存。 ");
  }

  const appliedFilterDate = requireValidPivotFilterDate(remoteResult.filterDate);
  if (appliedFilterDate !== requestedFilterDate) {
    throw new Error(`在线透视实际筛选日期${appliedFilterDate}与请求日期${requestedFilterDate}不一致。 `);
  }
  const pivotTableCount = Number(remoteResult.pivotTableCount);
  const successfulPivotTableCount = Number(remoteResult.successfulPivotTableCount);
  const failedPivotTables = Array.isArray(remoteResult.failedPivotTables)
    ? remoteResult.failedPivotTables
    : [];
  if (!Number.isInteger(pivotTableCount) || pivotTableCount < 1) {
    throw new Error("在线“透视结果”工作表中没有找到透视表。 ");
  }
  if (
    !Number.isInteger(successfulPivotTableCount) ||
    successfulPivotTableCount < 0 ||
    successfulPivotTableCount + failedPivotTables.length !== pivotTableCount
  ) {
    throw new Error("AirScript 返回的透视表执行数量不一致。 ");
  }
  if (remoteResult.saveCompleted !== true) {
    throw new Error("在线工作簿没有保存完成。 ");
  }

  return {
    scriptVersion: KDOCS_FILTER_AIRSCRIPT_VERSION,
    filterDate: appliedFilterDate,
    pivotTableCount,
    successfulPivotTableCount,
    failedPivotTableCount: failedPivotTables.length,
    failedPivotTables,
    saveCompleted: true
  };
}

module.exports = {
  isValidPivotFilterDate,
  requireValidPivotFilterDate,
  resolvePivotFilterDateInput,
  resolveExcelDateSerial,
  updateKdocsPivotEndDateFilter
};
