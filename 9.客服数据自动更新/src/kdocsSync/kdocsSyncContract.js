// CommonJS 会在进程内缓存本契约；升级版本后必须同时更新 AirScript 模板并重启 CLI。
// 三个脚本各自独立版本号，只改其中一个时无需联动另外两个。
const KDOCS_SYNC_AIRSCRIPT_VERSION = "2026-08-07.8";
const KDOCS_FILTER_AIRSCRIPT_VERSION = "2026-08-11.1";
const KDOCS_CUSTOMER_SERVICE_NAME_AIRSCRIPT_VERSION = "2026-08-07.8";
const KDOCS_FULL_SYNC_OPERATION = "sync_data_detail";
const KDOCS_PIVOT_FILTER_OPERATION = "update_pivot_end_date_filter_v3";
const KDOCS_CUSTOMER_SERVICE_NAME_OPERATION = "reapply_customer_service_name_filter_v1";
const KDOCS_DATA_SHEET_NAME = "数据明细";
const KDOCS_DATA_COLUMN_COUNT = 24;

function requireCurrentKdocsAirScriptVersion(remoteResult, requiredVersion, openScriptMenuLabel = "[3]") {
  const actualVersion = String(remoteResult?.scriptVersion || "").trim();
  if (actualVersion !== requiredVersion) {
    throw new Error(
      `在线 AirScript 版本不匹配（需要 ${requiredVersion}，在线返回${actualVersion ? ` ${actualVersion}` : "旧版无版本号"}），` +
      `请用菜单${openScriptMenuLabel}全选覆盖新脚本并按 Ctrl+S 保存。 `
    );
  }
  return actualVersion;
}

function normalizeRangeAddress(rangeAddress) {
  return String(rangeAddress || "")
    .trim()
    .replace(/^.*!/, "")
    .replace(/\$/g, "")
    .toUpperCase();
}

function columnNameToNumber(columnName) {
  return [...String(columnName || "").toUpperCase()].reduce((columnNumber, letter) => (
    columnNumber * 26 + letter.charCodeAt(0) - 64
  ), 0);
}

function parseKdocsDataRangeAddress(rangeAddress) {
  const normalizedRangeAddress = normalizeRangeAddress(rangeAddress);
  const matchedRange = normalizedRangeAddress.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!matchedRange) return null;
  const parsedRange = {
    rangeAddress: normalizedRangeAddress,
    startColumnNumber: columnNameToNumber(matchedRange[1]),
    startRowNumber: Number(matchedRange[2]),
    endColumnNumber: columnNameToNumber(matchedRange[3]),
    endRowNumber: Number(matchedRange[4])
  };
  if (
    parsedRange.startColumnNumber < 1 ||
    parsedRange.startRowNumber < 1 ||
    parsedRange.endColumnNumber < parsedRange.startColumnNumber ||
    parsedRange.endRowNumber < parsedRange.startRowNumber
  ) {
    return null;
  }
  return parsedRange;
}

function buildKdocsPivotSourceData(dataRangeAddress, sheetName = KDOCS_DATA_SHEET_NAME) {
  const parsedRange = parseKdocsDataRangeAddress(dataRangeAddress);
  if (!parsedRange) {
    throw new Error(`无法识别在线数据区域：${normalizeRangeAddress(dataRangeAddress) || "空"}。 `);
  }
  return (
    `=${sheetName}!R${parsedRange.startRowNumber}C${parsedRange.startColumnNumber}:` +
    `R${parsedRange.endRowNumber}C${parsedRange.endColumnNumber}`
  );
}

function isExpectedKdocsPivotSourceData(
  sourceData,
  dataRangeAddress,
  sheetName = KDOCS_DATA_SHEET_NAME
) {
  const parsedRange = parseKdocsDataRangeAddress(dataRangeAddress);
  if (!parsedRange) return false;
  const normalizedSourceData = String(sourceData || "")
    .replace(/\$/g, "")
    .replace(/'/g, "")
    .replace(/\s/g, "")
    .toUpperCase();
  const expectedR1C1SourceData = buildKdocsPivotSourceData(
    parsedRange.rangeAddress,
    sheetName
  ).toUpperCase();
  const expectedA1SourceData = `=${sheetName}!${parsedRange.rangeAddress}`.toUpperCase();
  return (
    normalizedSourceData === expectedR1C1SourceData ||
    normalizedSourceData === expectedA1SourceData
  );
}

function sanitizeKdocsDiagnosticText(value) {
  return String(value || "")
    .replace(
      /https:\/\/(?:www\.)?kdocs\.cn\/l\/[^/\s"']+\/?/gi,
      "[已隐藏的在线文档地址]"
    )
    .replace(
      /https:\/\/(?:www\.)?kdocs\.cn\/api\/v3\/ide\/file\/[^/\s"']+\/script\/[^/\s"']+\/sync_task\/?/gi,
      "[已隐藏的金山接口地址]"
    )
    .replace(
      /((?:AirScript-Token|apiToken|token|fileId|scriptId|file_id|script_id)\s*[=:]\s*["']?)[^\s,"';}]+/gi,
      "$1[已隐藏]"
    )
    .slice(0, 500);
}

module.exports = {
  KDOCS_SYNC_AIRSCRIPT_VERSION,
  KDOCS_FILTER_AIRSCRIPT_VERSION,
  KDOCS_CUSTOMER_SERVICE_NAME_AIRSCRIPT_VERSION,
  KDOCS_FULL_SYNC_OPERATION,
  KDOCS_PIVOT_FILTER_OPERATION,
  KDOCS_CUSTOMER_SERVICE_NAME_OPERATION,
  KDOCS_DATA_SHEET_NAME,
  KDOCS_DATA_COLUMN_COUNT,
  requireCurrentKdocsAirScriptVersion,
  normalizeRangeAddress,
  parseKdocsDataRangeAddress,
  buildKdocsPivotSourceData,
  isExpectedKdocsPivotSourceData,
  sanitizeKdocsDiagnosticText
};
