const fs = require("fs");
const path = require("path");
const {
  loadXlsxArchive,
  resolveWorksheetArchivePath,
  readArchiveXml,
  loadSharedStringStore,
  readWorksheetRows
} = require("../summaryData/xlsxWorkbookEngine");
const {
  detailSheetName,
  detailHeaderRowNumber,
  detailFirstDataRowNumber,
  requiredHeaders
} = require("../summaryData/summaryDataDetailSchema");

function readFixedWidthRow(worksheetCells, columnCount) {
  return Array.from({ length: columnCount }, (_, columnOffset) => {
    const rawValue = worksheetCells?.get(columnOffset + 1)?.value;
    return rawValue == null ? "" : rawValue;
  });
}

function normalizeKdocsCellValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return Number(value.toPrecision(15));
}

function normalizeKdocsDataDetailRows(dataDetailRows) {
  return dataDetailRows.map((rowValues) => rowValues.map(normalizeKdocsCellValue));
}

function hasCellValue(value) {
  return value != null && String(value).trim() !== "";
}

function requireExpectedDetailHeaders(headerValues) {
  for (let columnOffset = 0; columnOffset < requiredHeaders.length; columnOffset += 1) {
    const actualHeader = String(headerValues[columnOffset] ?? "").trim();
    if (actualHeader !== requiredHeaders[columnOffset]) {
      const excelColumnName = String.fromCharCode(65 + columnOffset);
      throw new Error(
        `本地数据明细第${excelColumnName}列应为「${requiredHeaders[columnOffset]}」，实际为「${actualHeader || "空"}」。 `
      );
    }
  }
}

function resolveLastDataRowNumber(worksheetRows) {
  const dataRowNumbers = [...worksheetRows.entries()]
    .filter(([rowNumber, cells]) => (
      rowNumber >= detailFirstDataRowNumber &&
      [...cells.values()].some((cell) => hasCellValue(cell?.value))
    ))
    .map(([rowNumber]) => rowNumber);
  return dataRowNumbers.length ? Math.max(...dataRowNumbers) : 0;
}

function dateTextToExcelSerial(dateText) {
  const matchedDate = String(dateText || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matchedDate) return NaN;
  const year = Number(matchedDate[1]);
  const month = Number(matchedDate[2]);
  const day = Number(matchedDate[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return NaN;
  }
  const utcMilliseconds = calendarDate.getTime();
  return (utcMilliseconds - Date.UTC(1899, 11, 30)) / 86400000;
}

function excelDateSerialToText(dateSerial) {
  const normalizedSerial = Number(dateSerial);
  if (!Number.isInteger(normalizedSerial)) {
    throw new Error(`无法识别 Excel 日期序号：${dateSerial}`);
  }
  const calendarDate = new Date(Date.UTC(1899, 11, 30) + normalizedSerial * 86400000);
  return [
    calendarDate.getUTCFullYear(),
    String(calendarDate.getUTCMonth() + 1).padStart(2, "0"),
    String(calendarDate.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function normalizeEndDateSerial(value, excelRowNumber) {
  const numericValue = Number(value);
  const dateSerial = Number.isFinite(numericValue) && String(value ?? "").trim() !== ""
    ? numericValue
    : dateTextToExcelSerial(value);
  if (!Number.isInteger(dateSerial) || dateSerial <= 0) {
    throw new Error(`本地数据明细第${excelRowNumber}行的统计结束日不是有效日期。 `);
  }
  return dateSerial;
}

function summarizeDataDetailEndDates(dataDetailRows) {
  const endDateRowCountBySerial = new Map();
  for (let rowIndex = 1; rowIndex < dataDetailRows.length; rowIndex += 1) {
    const dateSerial = normalizeEndDateSerial(dataDetailRows[rowIndex][1], rowIndex + detailHeaderRowNumber);
    endDateRowCountBySerial.set(dateSerial, (endDateRowCountBySerial.get(dateSerial) || 0) + 1);
  }
  const maxEndDateSerial = Math.max(...endDateRowCountBySerial.keys());
  return {
    maxEndDateSerial,
    maxEndDateText: excelDateSerialToText(maxEndDateSerial),
    maxEndDateRowCount: endDateRowCountBySerial.get(maxEndDateSerial),
    endDateRowCounts: [...endDateRowCountBySerial.entries()]
      .sort(([leftSerial], [rightSerial]) => leftSerial - rightSerial)
      .map(([dateSerial, rowCount]) => ({
        dateSerial,
        dateText: excelDateSerialToText(dateSerial),
        rowCount
      }))
  };
}

function buildDataDetailMatrix(worksheetRows) {
  const headerValues = readFixedWidthRow(worksheetRows.get(detailHeaderRowNumber), requiredHeaders.length);
  requireExpectedDetailHeaders(headerValues);
  const lastDataRowNumber = resolveLastDataRowNumber(worksheetRows);
  if (!lastDataRowNumber) {
    throw new Error("本地汇总表的“数据明细”没有数据，为避免误清空在线文档，本次未同步。 ");
  }

  const dataDetailRows = [headerValues];
  for (let rowNumber = detailFirstDataRowNumber; rowNumber <= lastDataRowNumber; rowNumber += 1) {
    const rowValues = readFixedWidthRow(worksheetRows.get(rowNumber), requiredHeaders.length);
    if (!hasCellValue(rowValues[6])) {
      throw new Error(`本地数据明细第${rowNumber}行缺少客服姓名，请先检查汇总表。 `);
    }
    dataDetailRows.push(rowValues);
  }
  const endDateSummary = summarizeDataDetailEndDates(dataDetailRows);
  return {
    dataDetailRows,
    dataRowCount: dataDetailRows.length - 1,
    columnCount: requiredHeaders.length,
    lastRowNumber: detailHeaderRowNumber + dataDetailRows.length - 1,
    targetRangeAddress: `A4:X${detailHeaderRowNumber + dataDetailRows.length - 1}`,
    firstPersonName: String(dataDetailRows[1][6] ?? ""),
    lastPersonName: String(dataDetailRows[dataDetailRows.length - 1][6] ?? ""),
    ...endDateSummary
  };
}

async function readDataDetailWorkbook(workbookPath) {
  const normalizedWorkbookPath = String(workbookPath || "").trim();
  if (
    path.extname(normalizedWorkbookPath).toLowerCase() !== ".xlsx" ||
    !fs.existsSync(normalizedWorkbookPath) ||
    !fs.statSync(normalizedWorkbookPath).isFile()
  ) {
    throw new Error(`本地汇总表不存在或不是 .xlsx 文件：${normalizedWorkbookPath || "未设置"}`);
  }
  const workbookArchive = await loadXlsxArchive(normalizedWorkbookPath);
  const sharedStringStore = await loadSharedStringStore(workbookArchive);
  const { worksheetPath } = await resolveWorksheetArchivePath(
    workbookArchive,
    "named_sheet",
    detailSheetName
  );
  const worksheetDocument = await readArchiveXml(workbookArchive, worksheetPath);
  const worksheetRows = readWorksheetRows(worksheetDocument, sharedStringStore.values);
  return buildDataDetailMatrix(worksheetRows);
}

module.exports = {
  readFixedWidthRow,
  normalizeKdocsCellValue,
  normalizeKdocsDataDetailRows,
  requireExpectedDetailHeaders,
  excelDateSerialToText,
  normalizeEndDateSerial,
  summarizeDataDetailEndDates,
  buildDataDetailMatrix,
  readDataDetailWorkbook
};
